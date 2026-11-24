package com.kaleox.deliveryya.service;

import com.kaleox.deliveryya.dto.paginatedDto.PaginatedNotificationDto;
import com.kaleox.deliveryya.dto.user.AccessNotificationDto;
import com.kaleox.deliveryya.dto.user.AccessNotificationResultDto;
import com.kaleox.deliveryya.dto.user.NotificationTemplateDto;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

public interface NotificationService {

    String sendNotification(NotificationTemplateDto dto);

    SseEmitter sendNotificationSse(NotificationTemplateDto dto);

    /**
     * Universal "notify every user that holds one of these accesses".
     *
     * <p>Targets are resolved synchronously (so the caller gets a count), delivery runs on the
     * notification executor after the current transaction commits.</p>
     */
    AccessNotificationResultDto notifyByAccess(AccessNotificationDto dto);

    /**
     * Fire-and-forget variant used inside other services (e.g. market creation). It never throws,
     * never blocks the caller and only runs if the caller's transaction commits.
     */
    void notifyByAccessAsync(AccessNotificationDto dto);

    PaginatedNotificationDto getAllNotifications(PaginatedNotificationDto dto);

    void deleteNotification(Integer id, Integer userId);

    void markAsRead(Integer id, Integer userId);
}
