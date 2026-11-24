package com.kaleox.deliveryya.dto.paginatedDto;

import jakarta.validation.constraints.NotNull;
import lombok.*;
import lombok.experimental.FieldDefaults;

import java.util.List;

@AllArgsConstructor
@NoArgsConstructor
@Builder
@Data
@FieldDefaults(level = AccessLevel.PRIVATE)
public class PaginatedCategoryDto {
    @NotNull
    Integer pageNumber;

    @NotNull
    Integer countPerPage;

    Long totalCount;
    Integer totalPages;

    Integer categoryId;
    Integer marketId;
    Boolean isActive;

    /**
     * Console screens need the disabled categories too (otherwise they could never be re-activated).
     * Storefront callers leave it out and keep getting active categories only.
     */
    @Builder.Default
    Boolean includeInactive = false;

    String search;
    List<?> items;
}
