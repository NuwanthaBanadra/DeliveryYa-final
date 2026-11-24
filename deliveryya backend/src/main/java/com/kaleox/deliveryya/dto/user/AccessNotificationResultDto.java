package com.kaleox.deliveryya.dto.user;

import lombok.*;
import lombok.experimental.FieldDefaults;

import java.util.ArrayList;
import java.util.List;

/**
 * Result of {@code POST /api/v1/notifications/notify-by-access}.
 *
 * <p>The delivery itself runs on the notification executor after the current transaction
 * commits, so this object reports what was <b>queued</b>, not what was delivered.</p>
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@FieldDefaults(level = AccessLevel.PRIVATE)
public class AccessNotificationResultDto {

    List<Integer> accessIds;

    Integer targetUserCount;

    @Builder.Default
    List<String> channels = new ArrayList<>();

    Boolean async;

    String desc;
}
