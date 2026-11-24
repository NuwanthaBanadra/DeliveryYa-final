package com.kaleox.deliveryya.dto.user;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import lombok.*;
import lombok.experimental.FieldDefaults;

import java.util.ArrayList;
import java.util.List;

/**
 * Universal "notify everybody who holds this access" request.
 *
 * <p>Used by {@code POST /api/v1/notifications/notify-by-access} and internally by any service
 * that has to tell a group of users about something (e.g. a new market waiting for approval).</p>
 *
 * <ul>
 *   <li>{@code accessIds} – every user that holds one of these accesses is notified. Both
 *       grant routes are honoured: the user's role ({@code access_has_user_roles}) and direct
 *       user grants ({@code user_has_access}, expired grants ignored).</li>
 *   <li>{@code channels} – {@code MESSAGE} (in-app notification + push), {@code EMAIL}, {@code SMS}.
 *       Empty / omitted means {@code MESSAGE} only.</li>
 *   <li>{@code navigateTo} – console route stored with the in-app notification; the client opens
 *       it when the notification is clicked.</li>
 * </ul>
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@FieldDefaults(level = AccessLevel.PRIVATE)
public class AccessNotificationDto {

    @NotEmpty(message = "title is required")
    @Size(max = 100, message = "title must not exceed 100 characters")
    String title;

    @NotEmpty(message = "message is required")
    String message;

    @NotEmpty(message = "accessIds is required")
    @Builder.Default
    List<Integer> accessIds = new ArrayList<>();

    /** Optional route the client opens when the notification is clicked (e.g. "/markets"). */
    String navigateTo;

    /** MESSAGE | EMAIL | SMS. Empty means MESSAGE only. */
    @Builder.Default
    List<String> channels = new ArrayList<>();

    /** E-mail subject. Defaults to {@code title}. */
    String emailSubject;

    /** Optional HTML body for the e-mail. A simple card is generated when it is blank. */
    String emailDesign;

    /** SMS text. Defaults to {@code message}. */
    String smsMessage;

    /** Users that must not receive this notification (e.g. the user who triggered it). */
    @Builder.Default
    List<Integer> excludeUserIds = new ArrayList<>();
}
