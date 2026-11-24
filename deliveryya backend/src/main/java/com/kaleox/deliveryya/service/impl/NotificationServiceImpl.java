package com.kaleox.deliveryya.service.impl;

import com.kaleox.deliveryya.config.BusinessException;
import com.kaleox.deliveryya.config.NotificationAsyncConfig.NotificationExecutor;
import com.kaleox.deliveryya.dto.EmailDto;
import com.kaleox.deliveryya.dto.NotificationDto;
import com.kaleox.deliveryya.dto.SmsSingleDto;
import com.kaleox.deliveryya.dto.paginatedDto.PaginatedNotificationDto;
import com.kaleox.deliveryya.dto.user.AccessNotificationDto;
import com.kaleox.deliveryya.dto.user.AccessNotificationResultDto;
import com.kaleox.deliveryya.dto.user.NotificationTemplateDto;
import com.kaleox.deliveryya.entities.AccessHasUserRole;
import com.kaleox.deliveryya.entities.AccessToken;
import com.kaleox.deliveryya.entities.Notification;
import com.kaleox.deliveryya.entities.User;
import com.kaleox.deliveryya.entities.UserData;
import com.kaleox.deliveryya.entities.UserHasAccess;
import com.kaleox.deliveryya.entities.UserRole;
import com.kaleox.deliveryya.repo.AccessHasUserRoleRepo;
import com.kaleox.deliveryya.repo.AccessTokenRepo;
import com.kaleox.deliveryya.repo.NotificationRepo;
import com.kaleox.deliveryya.repo.UserDataRepo;
import com.kaleox.deliveryya.repo.UserHasAccessRepo;
import com.kaleox.deliveryya.repo.UserRepo;
import com.kaleox.deliveryya.service.EmailService;
import com.kaleox.deliveryya.service.NotificationService;
import com.kaleox.deliveryya.service.SmsService;
import com.kaleox.deliveryya.utill.FirebaseAuthUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional
public class NotificationServiceImpl implements NotificationService {

    private final RestTemplate restTemplate = new RestTemplate();
    private final String FCM_API_URL = "https://fcm.googleapis.com/v1/projects/deliveryya-3b144/messages:send";

    private static final String CHANNEL_MESSAGE = "MESSAGE";
    private static final String CHANNEL_EMAIL = "EMAIL";
    private static final String CHANNEL_SMS = "SMS";

    private final UserRepo userRepo;
    private final AccessTokenRepo accessTokenRepo;
    private final NotificationRepo notificationRepo;
    private final UserDataRepo userDataRepo;
    private final UserHasAccessRepo userHasAccessRepo;
    private final AccessHasUserRoleRepo accessHasUserRoleRepo;
    private final EmailService emailService;
    private final SmsService smsService;
    private final NotificationExecutor notificationTaskExecutor;

    private record NotificationSendResult(int sentCount, int failedCount, int removedUnregisteredCount, int totalTargetTokens) {
    }

    @Override
    public String sendNotification(NotificationTemplateDto dto) {
        NotificationSendResult result = processNotification(dto, null);

        return "Notifications sent successfully. Sent: " + result.sentCount
                + ", Failed: " + result.failedCount
                + ", Removed unregistered tokens: " + result.removedUnregisteredCount;
    }

    @Override
    public SseEmitter sendNotificationSse(NotificationTemplateDto dto) {
        SseEmitter emitter = new SseEmitter(0L);

        CompletableFuture.runAsync(() -> {
            try {
                sendEvent(emitter, "started", Map.of("message", "Notification sending started"));

                NotificationSendResult result = processNotification(dto, (processed, total, sent, failed, removed) -> {
                    int progress = total == 0 ? 100 : (processed * 100) / total;
                    sendEvent(emitter, "progress", Map.of(
                            "processedTokens", processed,
                            "totalTokens", total,
                            "progress", progress,
                            "sent", sent,
                            "failed", failed,
                            "removedUnregistered", removed
                    ));
                });

                sendEvent(emitter, "completed", Map.of(
                        "message", "Notifications sent successfully",
                        "sent", result.sentCount,
                        "failed", result.failedCount,
                        "removedUnregistered", result.removedUnregisteredCount,
                        "totalTokens", result.totalTargetTokens
                ));
                emitter.complete();
            } catch (Exception ex) {
                try {
                    sendEvent(emitter, "error", Map.of("message", ex.getMessage() != null ? ex.getMessage() : "Notification sending failed"));
                } catch (Exception eventException) {
                    log.warn("Failed to send SSE error event", eventException);
                }
                emitter.completeWithError(ex);
            }
        });

        return emitter;
    }

    // ------------------------------------------------------------------
    // Universal "notify everybody who holds this access"
    // ------------------------------------------------------------------

    @Override
    @Transactional(readOnly = true)
    public AccessNotificationResultDto notifyByAccess(AccessNotificationDto dto) {
        List<String> channels = normalizeChannels(dto.getChannels());
        List<User> targetUsers = resolveAccessTargets(dto);

        if (!targetUsers.isEmpty()) {
            executeAfterCommit(() -> dispatchAccessNotification(targetUsers, dto, channels));
        }

        return AccessNotificationResultDto.builder()
                .accessIds(dto.getAccessIds())
                .targetUserCount(targetUsers.size())
                .channels(channels)
                .async(true)
                .desc(targetUsers.isEmpty()
                        ? "No active user holds the requested access ids - nothing was queued"
                        : "Notification queued for " + targetUsers.size() + " user(s)")
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public void notifyByAccessAsync(AccessNotificationDto dto) {
        try {
            List<String> channels = normalizeChannels(dto.getChannels());
            executeAfterCommit(() -> {
                List<User> targetUsers = resolveAccessTargets(dto);
                if (targetUsers.isEmpty()) {
                    log.warn("Access notification '{}' skipped - no active user holds access ids {}",
                            dto.getTitle(), dto.getAccessIds());
                    return;
                }
                dispatchAccessNotification(targetUsers, dto, channels);
            });
        } catch (Exception ex) {
            log.warn("Could not queue access notification '{}' for access ids {}",
                    dto.getTitle(), dto.getAccessIds(), ex);
        }
    }

    /**
     * Every active user that holds one of the requested accesses - either through the role grant
     * ({@code access_has_user_roles}) or through a direct user grant ({@code user_has_access},
     * expired grants ignored). Users listed in {@code excludeUserIds} are removed.
     */
    private List<User> resolveAccessTargets(AccessNotificationDto dto) {
        List<Integer> accessIds = dto.getAccessIds() == null ? List.of()
                : dto.getAccessIds().stream().filter(Objects::nonNull).distinct().toList();

        if (accessIds.isEmpty()) {
            throw new BusinessException("accessIds is required", null);
        }

        Set<Integer> userIds = new LinkedHashSet<>();

        // 1. role grants
        Set<Integer> roleIds = accessHasUserRoleRepo.findAllByAccess_IdIn(accessIds).stream()
                .map(AccessHasUserRole::getUserRoles)
                .filter(Objects::nonNull)
                .map(UserRole::getId)
                .filter(Objects::nonNull)
                .collect(Collectors.toCollection(LinkedHashSet::new));

        if (!roleIds.isEmpty()) {
            userRepo.findAllByUserRole_IdIn(roleIds).stream()
                    .filter(user -> Boolean.TRUE.equals(user.getIsActive()))
                    .map(User::getId)
                    .filter(Objects::nonNull)
                    .forEach(userIds::add);
        }

        // 2. direct user grants (skip expired ones)
        LocalDateTime now = LocalDateTime.now();
        userHasAccessRepo.findAllByAccess_IdIn(accessIds).stream()
                .filter(grant -> grant.getExp() == null || grant.getExp().isAfter(now))
                .map(UserHasAccess::getUsers)
                .filter(Objects::nonNull)
                .map(User::getId)
                .filter(Objects::nonNull)
                .forEach(userIds::add);

        // 3. exclusions
        if (dto.getExcludeUserIds() != null) {
            dto.getExcludeUserIds().stream().filter(Objects::nonNull).forEach(userIds::remove);
        }

        if (userIds.isEmpty()) {
            return List.of();
        }

        return userRepo.findAllById(userIds).stream()
                .filter(user -> Boolean.TRUE.equals(user.getIsActive()))
                .sorted(Comparator.comparing(User::getId))
                .toList();
    }

    /**
     * Delivers the requested channels. Runs on the notification executor: one failing user never
     * stops the others, and nothing is thrown back to the caller.
     */
    private void dispatchAccessNotification(List<User> targetUsers, AccessNotificationDto dto, List<String> channels) {
        String navigateTo = normalizeNavigateTo(dto.getNavigateTo());
        boolean sendMessage = channels.contains(CHANNEL_MESSAGE);
        boolean sendEmail = channels.contains(CHANNEL_EMAIL);
        boolean sendSms = channels.contains(CHANNEL_SMS);

        String emailSubject = defaultIfBlank(dto.getEmailSubject(), dto.getTitle());
        String emailDesign = defaultIfBlank(dto.getEmailDesign(), buildEmailDesign(dto.getTitle(), dto.getMessage(), navigateTo));
        String smsText = defaultIfBlank(dto.getSmsMessage(), dto.getMessage());

        int messageCount = 0;
        int emailCount = 0;
        int smsCount = 0;
        int failedCount = 0;

        for (User user : targetUsers) {
            try {
                if (sendMessage) {
                    notificationRepo.save(Notification.builder()
                            .users(user)
                            .title(dto.getTitle())
                            .message(dto.getMessage())
                            .navigateTo(navigateTo)
                            .isRead(false)
                            .build());
                    messageCount++;
                    pushToUser(user, dto.getTitle(), dto.getMessage());
                }

                if (sendEmail) {
                    String email = user.getEmail();
                    if (email != null && !email.isBlank()) {
                        emailService.sendEmail(EmailDto.builder()
                                .email(email.trim())
                                .subject(emailSubject)
                                .design(emailDesign)
                                .route(navigateTo == null ? "" : navigateTo)
                                .build());
                        emailCount++;
                    }
                }

                if (sendSms) {
                    String mobile = resolvePrimaryMobile(user);
                    if (mobile != null && !mobile.isBlank()) {
                        // Reuses the existing SMS gateway (smslenz.lk wiring in SmsServiceImpl).
                        smsService.sendSingleSms(SmsSingleDto.builder()
                                .contact(mobile.trim())
                                .message(smsText)
                                .build());
                        smsCount++;
                    }
                }
            } catch (Exception ex) {
                failedCount++;
                log.warn("Access notification '{}' failed for user id {}", dto.getTitle(), user.getId(), ex);
            }
        }

        log.info("Access notification '{}' (access ids {}) -> in-app: {}, email: {}, sms: {}, failed: {}",
                dto.getTitle(), dto.getAccessIds(), messageCount, emailCount, smsCount, failedCount);
    }

    /** schedules the task on the notification pool once the caller's transaction commits (if any). */
    private void executeAfterCommit(Runnable task) {
        Runnable guardedTask = () -> {
            try {
                task.run();
            } catch (Exception ex) {
                log.error("Notification dispatch failed", ex);
            }
        };

        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    notificationTaskExecutor.execute(guardedTask);
                }
            });
        } else {
            notificationTaskExecutor.execute(guardedTask);
        }
    }

    /**
     * Push notification for the in-app channel. Uses all of the user's device tokens, skips
     * unregistered ones and never throws - the in-app row is the source of truth.
     */
    private void pushToUser(User user, String title, String message) {
        try {
            List<AccessToken> tokens = accessTokenRepo.findAllByUsers(user);
            if (tokens == null || tokens.isEmpty()) {
                return;
            }

            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(FirebaseAuthUtil.getAccessToken());
            headers.setContentType(MediaType.APPLICATION_JSON);

            for (AccessToken token : tokens) {
                sendPushToToken(token, headers, title, message);
            }
        } catch (Exception ex) {
            // The in-app row is already stored - a push failure must not break the batch.
            log.warn("Push notification failed for user id {}", user.getId(), ex);
        }
    }

    private void sendPushToToken(AccessToken token, HttpHeaders headers, String title, String message) {
        String payload = "{"
                + "\"message\":{"
                + "\"token\":\"" + token.getToken() + "\","
                + "\"notification\":{"
                + "\"title\":\"" + escapeJson(title) + "\","
                + "\"body\":\"" + escapeJson(message) + "\""
                + "},"
                + "\"data\":{"
                + "\"type\":\"" + CHANNEL_MESSAGE + "\""
                + "}"
                + "}"
                + "}";

        try {
            restTemplate.postForEntity(FCM_API_URL, new HttpEntity<>(payload, headers), String.class);
        } catch (HttpClientErrorException.NotFound ex) {
            if (ex.getResponseBodyAsString().contains("UNREGISTERED")) {
                accessTokenRepo.delete(token);
                return;
            }
            log.warn("FCM 404 while sending notification to token id {}", token.getId(), ex);
        } catch (RestClientException ex) {
            log.warn("FCM send failed for token id {}", token.getId(), ex);
        } catch (Exception ex) {
            log.warn("Unexpected FCM failure for token id {}", token.getId(), ex);
        }
    }

    private String resolvePrimaryMobile(User user) {
        try {
            return userDataRepo.findByUsers_Id(user.getId()).stream()
                    .map(UserData::getPrimaryMobile)
                    .filter(mobile -> mobile != null && !mobile.isBlank())
                    .findFirst()
                    .orElse(null);
        } catch (Exception ex) {
            log.warn("Could not resolve the mobile number of user id {}", user.getId(), ex);
            return null;
        }
    }

    /** Empty / missing -> MESSAGE only; anything unknown is rejected before anything is sent. */
    private List<String> normalizeChannels(List<String> channels) {
        if (channels == null || channels.isEmpty()) {
            return List.of(CHANNEL_MESSAGE);
        }

        List<String> normalized = channels.stream()
                .filter(Objects::nonNull)
                .map(channel -> channel.trim().toUpperCase(Locale.ROOT))
                .filter(channel -> !channel.isEmpty())
                .distinct()
                .toList();

        if (normalized.isEmpty()) {
            return List.of(CHANNEL_MESSAGE);
        }

        for (String channel : normalized) {
            if (!CHANNEL_MESSAGE.equals(channel) && !CHANNEL_EMAIL.equals(channel) && !CHANNEL_SMS.equals(channel)) {
                throw new BusinessException("Unsupported notification channel: " + channel,
                        Map.of("channels", "Allowed values: MESSAGE, EMAIL, SMS"));
            }
        }

        return normalized;
    }

    private String buildEmailDesign(String title, String message, String navigateTo) {
        String safeTitle = escapeHtml(title);
        String safeMessage = escapeHtml(message).replace("\n", "<br/>");
        String pageNote = navigateTo == null || navigateTo.isBlank()
                ? ""
                : "<p style=\"margin:16px 0 0;color:#6b7280;font-size:12px;\">Open this page in the console: "
                + "<strong>" + escapeHtml(navigateTo) + "</strong></p>";

        return "<div style=\"font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px;\">"
                + "<div style=\"max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;"
                + "border-radius:12px;padding:24px;\">"
                + "<h2 style=\"margin:0 0 12px;color:#111827;font-size:20px;\">" + safeTitle + "</h2>"
                + "<p style=\"margin:0;color:#374151;font-size:14px;line-height:1.6;\">" + safeMessage + "</p>"
                + pageNote
                + "<p style=\"margin:24px 0 0;color:#9ca3af;font-size:12px;\">DeliveryYa</p>"
                + "</div></div>";
    }

    private String escapeHtml(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }

    private String escapeJson(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    private String defaultIfBlank(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private NotificationSendResult processNotification(NotificationTemplateDto dto, ProgressCallback progressCallback) {
        HttpHeaders headers = new HttpHeaders();
        String accessToken = FirebaseAuthUtil.getAccessToken();

        headers.setBearerAuth(accessToken);
        headers.setContentType(MediaType.APPLICATION_JSON);

        List<Integer> requestedUserIds = dto.getToUsers();
        if (requestedUserIds == null || requestedUserIds.isEmpty()) {
            throw new BusinessException("toUsers is required", null);
        }

        Set<Integer> uniqueUserIds = new LinkedHashSet<>(requestedUserIds);
        Map<Integer, User> usersById = userRepo.findAllById(uniqueUserIds).stream()
                .collect(Collectors.toMap(User::getId, user -> user));

        if (usersById.size() != uniqueUserIds.size()) {
            List<Integer> missingUsers = uniqueUserIds.stream()
                    .filter(userId -> !usersById.containsKey(userId))
                    .toList();
            throw new BusinessException("Retrieving User not found for ids: " + missingUsers, null);
        }

        List<Integer> notifyTo = dto.getNotifyTo();

        Map<Integer, List<AccessToken>> filteredTokensByUser = new LinkedHashMap<>();
        int totalTargetTokens = 0;

        for (Integer userId : uniqueUserIds) {
            User user = usersById.get(userId);
            List<AccessToken> tokens = accessTokenRepo.findAllByUsers(user);

            List<AccessToken> filteredTokens;
            if (notifyTo == null || notifyTo.isEmpty()) {
                filteredTokens = tokens;
            } else {
                filteredTokens = tokens.stream()
                        .filter(token -> notifyTo.stream().anyMatch(id -> id.equals(token.getTokenType().getId())))
                        .toList();
            }

            filteredTokensByUser.put(userId, filteredTokens);
            totalTargetTokens += filteredTokens.size();
        }

        int sentNotificationsCount = 0;
        int failedNotificationsCount = 0;
        int removedUnregisteredTokensCount = 0;
        int processedTokensCount = 0;

        for (Integer userId : uniqueUserIds) {
            User user = usersById.get(userId);

            if (dto.getNotificationType().equals("MESSAGE")) {
                notificationRepo.save(Notification.builder()
                        .users(user)
                        .title(dto.getTitle())
                        .message(dto.getMessage())
                        .navigateTo(normalizeNavigateTo(dto.getNavigateTo()))
                        .isRead(false)
                        .build());
            }

            List<AccessToken> accessTokenList = filteredTokensByUser.getOrDefault(userId, new ArrayList<>());
            if (accessTokenList.isEmpty()) {
                continue;
            }

            // Iterate over tokens
            for (AccessToken token : accessTokenList) {

                // ✅ Build v1 API payload
                String payload = "{"
                        + "\"message\":{"
                        + "\"token\":\"" + token.getToken() + "\","
                        + "\"notification\":{"
                        + "\"title\":\"" + dto.getTitle() + "\","
                        + "\"body\":\"" + dto.getMessage() + "\""
                        + "},"
                        + "\"data\":{"
                        + "\"type\":\"" + dto.getNotificationType() + "\""
                        + "}"
                        + "}"
                        + "}";

                HttpEntity<String> request = new HttpEntity<>(payload, headers);
                try {
                    restTemplate.postForEntity(FCM_API_URL, request, String.class);
                    sentNotificationsCount++;
                } catch (HttpClientErrorException.NotFound ex) {
                    String responseBody = ex.getResponseBodyAsString();
                    if (responseBody.contains("UNREGISTERED")) {
                        accessTokenRepo.delete(token);
                        removedUnregisteredTokensCount++;
                        continue;
                    }
                    failedNotificationsCount++;
                    log.warn("FCM 404 while sending notification to token id {}", token.getId(), ex);
                } catch (RestClientException ex) {
                    failedNotificationsCount++;
                    log.warn("FCM send failed for token id {}", token.getId(), ex);
                }

                processedTokensCount++;
                if (progressCallback != null) {
                    progressCallback.onProgress(processedTokensCount, totalTargetTokens, sentNotificationsCount, failedNotificationsCount, removedUnregisteredTokensCount);
                }
            }
        }

        if (sentNotificationsCount == 0) {
            throw new BusinessException("Could not send notifications. No valid device tokens were available for requested users/devices", null);
        }

        return new NotificationSendResult(sentNotificationsCount, failedNotificationsCount, removedUnregisteredTokensCount, totalTargetTokens);
    }

    /**
     * Normalises the optional client route: trims it, drops blanks to null and makes sure it
     * starts with a slash ("manage-users" and "/manage-users" both become "/manage-users").
     */
    private String normalizeNavigateTo(String navigateTo) {
        if (navigateTo == null) {
            return null;
        }
        String trimmed = navigateTo.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        return trimmed.startsWith("/") ? trimmed : "/" + trimmed;
    }

    private void sendEvent(SseEmitter emitter, String eventName, Object payload) {
        try {
            emitter.send(SseEmitter.event().name(eventName).data(payload));
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    @FunctionalInterface
    private interface ProgressCallback {
        void onProgress(int processedTokens, int totalTokens, int sent, int failed, int removedUnregistered);
    }

    @Override
    public PaginatedNotificationDto getAllNotifications(PaginatedNotificationDto dto) {
        Pageable pageable = PageRequest.of(dto.getPageNumber(), dto.getCountPerPage(), Sort.by("id").descending());
        Page<Notification> notifications = notificationRepo.findAllByUsersId(dto.getUserId(), pageable);

        List<NotificationDto> notificationDtos = notifications.stream().map(notification -> NotificationDto.builder()
                .id(notification.getId())
                .title(notification.getTitle())
                .message(notification.getMessage())
                .isRead(notification.getIsRead())
                .userId(notification.getUsers().getId())
                .navigateTo(notification.getNavigateTo())
                .build()).toList();

        dto.setTotalCount(notifications.getTotalElements());
        dto.setTotalPages(notifications.getTotalPages());
        dto.setItems(notificationDtos);

        return dto;
    }

    @Override
    public void deleteNotification(Integer id, Integer userId) {
        Notification notification = notificationRepo.findById(id)
                .orElseThrow(() -> new BusinessException("Notification not found", null));

//        if (!notification.getUsers().getId().equals(userId)) {
//            throw new BusinessException("You are not authorized to delete this notification", null);
//        }

        notificationRepo.delete(notification);
    }

    @Override
    public void markAsRead(Integer id, Integer userId) {
        Notification notification = notificationRepo.findById(id)
                .orElseThrow(() -> new BusinessException("Notification not found", null));

        if (!notification.getUsers().getId().equals(userId)) {
            throw new BusinessException("You are not authorized to mark this notification as read", null);
        }

        notification.setIsRead(true);
        notificationRepo.save(notification);
    }
}
