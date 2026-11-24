package com.kaleox.deliveryya.controller;

import com.kaleox.deliveryya.dto.ResponseDto;
import com.kaleox.deliveryya.dto.paginatedDto.PaginatedNotificationDto;
import com.kaleox.deliveryya.dto.user.AccessNotificationDto;
import com.kaleox.deliveryya.dto.user.AccessNotificationResultDto;
import com.kaleox.deliveryya.dto.user.NotificationTemplateDto;
import com.kaleox.deliveryya.service.NotificationService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Set;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/notifications")
@RequiredArgsConstructor
public class NotificationController {

    private final NotificationService notificationService;

    @PostMapping("/send-notification")
    public ResponseEntity<ResponseDto<Void>> sendNotification(@Valid @RequestBody NotificationTemplateDto dto) {

        ResponseDto<Void> response = ResponseDto.<Void>builder()
                .message("Success")
                .desc(notificationService.sendNotification(dto))
                .build();

        return ResponseEntity.ok(response);
    }

    @PostMapping(value = "/send-notification-sse", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter sendNotificationSse(@Valid @RequestBody NotificationTemplateDto dto) {
        return notificationService.sendNotificationSse(dto);
    }

    /**
     * Universal "notify every user that holds one of these accesses".
     *
     * <p>Channels: MESSAGE (in-app notification + push), EMAIL, SMS. Delivery is asynchronous -
     * the response only reports how many users were queued.</p>
     */
    @PostMapping("/notify-by-access")
    public ResponseEntity<ResponseDto<AccessNotificationResultDto>> notifyByAccess(@Valid @RequestBody AccessNotificationDto dto) {
        AccessNotificationResultDto result = notificationService.notifyByAccess(dto);

        return ResponseEntity.ok(ResponseDto.<AccessNotificationResultDto>builder()
                .message("Success")
                .desc(result.getDesc())
                .object(result)
                .build());
    }

    @PostMapping("/get-all-notifications")
    public ResponseEntity<ResponseDto<PaginatedNotificationDto>> getAllNotifications(@AuthenticationPrincipal UserDetails userDetails, @RequestBody PaginatedNotificationDto dto) {

        if (dto.getUserId() == null || dto.getUserId() == 0) {
            dto.setUserId(Integer.parseInt(userDetails.getUsername()));
        }

        Set<String> roles = userDetails.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .collect(Collectors.toSet());

        if (!roles.contains("ROLE_SUPER_ADMIN") && !roles.contains("ROLE_ADMIN") && !roles.contains("ROLE_OWNER") &&
                !roles.contains("ROLE_MANAGER")  && !roles.contains("ROLE_SECRETORY") &&
                !roles.contains("ROLE_ACCOUNTS_MANAGER") && !roles.contains("ROLE_ACCOUNT_ASSISTANT") &&
                !roles.contains("ROLE_MARKETS_MANAGER")) {

            dto.setUserId(Integer.parseInt(userDetails.getUsername()));
        }



        return ResponseEntity.ok(ResponseDto.<PaginatedNotificationDto>builder()
                .message("Success")
                .object(notificationService.getAllNotifications(dto))
                .build());
    }

    @DeleteMapping("/delete-notification")
    public ResponseEntity<ResponseDto<Void>> deleteNotification(@AuthenticationPrincipal UserDetails userDetails, @RequestParam Integer id) {
        notificationService.deleteNotification(id, Integer.parseInt(userDetails.getUsername()));
        return ResponseEntity.ok(ResponseDto.<Void>builder()
                .message("Success")
                .desc("Notification deleted successfully")
                .build());
    }

    @PutMapping("/mark-as-read")
    public ResponseEntity<ResponseDto<Void>> markAsRead(@AuthenticationPrincipal UserDetails userDetails, @RequestParam Integer id) {
        notificationService.markAsRead(id, Integer.parseInt(userDetails.getUsername()));
        return ResponseEntity.ok(ResponseDto.<Void>builder()
                .message("Success")
                .desc("Notification marked as read successfully")
                .build());
    }
}
