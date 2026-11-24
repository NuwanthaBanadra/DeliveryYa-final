package com.kaleox.deliveryya.service.impl;

import com.kaleox.deliveryya.config.BusinessException;
import com.kaleox.deliveryya.dto.BranchDto;
import com.kaleox.deliveryya.dto.ForceDeleteConfirmDto;
import com.kaleox.deliveryya.dto.ForceDeletePreviewDto;
import com.kaleox.deliveryya.dto.ResponseDto;
import com.kaleox.deliveryya.dto.customDto.CommonIdNameDto;
import com.kaleox.deliveryya.dto.paginatedDto.PaginatedBranchDto;
import com.kaleox.deliveryya.dto.user.UserEmployeeDto;
import com.kaleox.deliveryya.entities.Branch;
import com.kaleox.deliveryya.entities.BranchHasEmployee;
import com.kaleox.deliveryya.entities.City;
import com.kaleox.deliveryya.entities.Employee;
import com.kaleox.deliveryya.repo.*;
import com.kaleox.deliveryya.service.BranchService;
import com.kaleox.deliveryya.service.WalletService;
import com.kaleox.deliveryya.service.specification.BranchSpec;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
@Transactional
@RequiredArgsConstructor
public class BranchServiceImpl implements BranchService {

    private final BranchRepo branchRepo;
    private final JdbcTemplate jdbcTemplate;
    private final CityRepo cityRepo;
    private final UserRepo userRepo;
    private final EmployeeRepo employeeRepo;
    private final BranchHasEmployeeRepo branchHasEmployeeRepo;
    private final WalletService walletService;

    @Override
    public String setBranch(BranchDto dto, int userId) {
        userRepo.findById(userId)
                .orElseThrow(() -> new BusinessException("User not found", null));

        City city = cityRepo.findById(dto.getCity().getId())
                .orElseThrow(() -> new BusinessException("City not found", null));

        if (dto.getId() != null) {
            Branch existing = branchRepo.findById(dto.getId())
                    .orElseThrow(() -> new BusinessException("Branch not found", null));
            existing.setName(dto.getName());
            existing.setMainLine(dto.getMainLine());
            existing.setLocation(dto.getLocation());
            existing.setCity(city);
            branchRepo.save(existing);
            return "Branch updated successfully";
        }

        Branch branch = branchRepo.save(Branch.builder()
                .name(dto.getName())
                .mainLine(dto.getMainLine())
                .location(dto.getLocation())
                .city(city)
                .build());
        walletService.initializeBranchWallet(branch.getId());

        return "Branch created successfully";
    }

    @Override
    public ResponseDto<PaginatedBranchDto> getBranches(PaginatedBranchDto dto) {
        Pageable pageable = PageRequest.of(dto.getPageNumber(), dto.getCountPerPage(), Sort.by("id").ascending());

        Specification<Branch> spec = BranchSpec.getBranchSpecification(dto);

        Page<Branch> branches = branchRepo.findAll(spec, pageable);

        dto.setTotalCount(branches.getTotalElements());
        dto.setTotalPages(branches.getTotalPages());
        dto.setCountPerPage(branches.getSize());

        List<BranchDto> branchDtoList = branches.getContent().stream()
                .map(b -> new BranchDto(
                        b.getId(),
                        b.getName(),
                        b.getMainLine(),
                        b.getLocation(),
                        CommonIdNameDto.builder()
                                .id(b.getCity().getId())
                                .name(b.getCity().getName())
                                .build()
                ))
                .toList();

        dto.setItems(branchDtoList);

        return ResponseDto.<PaginatedBranchDto>builder()
                .message("Success")
                .desc("Branches fetched successfully.")
                .object(dto)
                .build();
    }

    @Override
    public List<BranchDto> getBranchesForEmployee(@NotNull Integer userId) {

        userRepo.findById(userId).orElseThrow(() -> new BusinessException("User not found", null));
        employeeRepo.findByUsers_Id(userId).orElseThrow(() -> new BusinessException("Employee not found", null));

        return branchHasEmployeeRepo.findByEmployee_Users_Id(userId).stream()
                .map(BranchHasEmployee::getBranch)
                .map(this::toBranchDto)
                .toList();
    }

    @Override
    public List<UserEmployeeDto> getEmployees(Integer branchId) {
        branchRepo.findById(branchId).orElseThrow(() -> new BusinessException("Branch not found", null));
        return branchHasEmployeeRepo.findByBranch_Id(branchId).stream()
                .map(BranchHasEmployee::getEmployee)
                .map(this::toEmployeeDto)
                .toList();
    }

    @Override
    public String assignEmployee(Integer branchId, Integer employeeId) {
        Branch branch = branchRepo.findById(branchId)
                .orElseThrow(() -> new BusinessException("Branch not found", null));
        Employee employee = employeeRepo.findById(employeeId)
                .orElseThrow(() -> new BusinessException("Employee not found", null));
        if (branchHasEmployeeRepo.findByBranch_IdAndEmployee_Id(branchId, employeeId).isEmpty()) {
            branchHasEmployeeRepo.save(BranchHasEmployee.builder().branch(branch).employee(employee).build());
        }
        return "Employee assigned to branch successfully";
    }

    @Override
    public String assignUser(Integer branchId, Integer userId) {
        Employee employee = employeeRepo.findByUsers_Id(userId)
                .orElseThrow(() -> new BusinessException("User is not an employee", null));
        return assignEmployee(branchId, employee.getId());
    }

    @Override
    public String removeEmployee(Integer branchId, Integer employeeId) {
        BranchHasEmployee assignment = branchHasEmployeeRepo.findByBranch_IdAndEmployee_Id(branchId, employeeId)
                .orElseThrow(() -> new BusinessException("Employee is not assigned to this branch", null));
        branchHasEmployeeRepo.delete(assignment);
        return "Employee removed from branch successfully";
    }

    private static final int MAX_BRANCH_DELETE_PREVIEW_ROWS = 50;
    private static final String SAFE_BRANCH_WALLET_FILTER = "branch_id = ? AND payment_record_id IS NULL "
            + "AND payment_category_id IS NULL AND payment_status_id IS NULL AND code IS NULL "
            + "AND other_reason IS NULL AND to_or_from IS NULL AND is_expense = 0 "
            + "AND COALESCE(amount, 0) = 0 AND COALESCE(balance, 0) = 0 "
            + "AND note = 'Branch wallet initialized' AND ref = CONCAT('BRANCH-', branch_id)";

    @Override
    public ResponseDto<ForceDeletePreviewDto> previewForceDeleteBranch(Integer branchId) {
        if (branchId == null || branchId <= 0) {
            throw new BusinessException("Branch ID is required", Map.of("branchId", "ID must be greater than zero"));
        }
        Branch branch = branchRepo.findById(branchId)
                .orElseThrow(() -> new BusinessException("Branch not found with id: " + branchId, null));
        BranchDeleteImpact impact = collectBranchDeleteImpact(branchId);
        ForceDeletePreviewDto preview = ForceDeletePreviewDto.builder()
                .entityName("Branch")
                .entityId(branchId)
                .entityIdentifier(branch.getName())
                .canDelete(impact.blockingReasons().isEmpty())
                .blockingReason(impact.blockingReasons().isEmpty() ? null : String.join(" ", impact.blockingReasons()))
                .relatedRecordCounts(impact.relatedRecordCounts())
                .recordsToBeDeleted(impact.blockingReasons().isEmpty() ? impact.recordsToBeDeleted() : List.of())
                .recordsToBeDetached(List.of())
                .build();
        return ResponseDto.<ForceDeletePreviewDto>builder()
                .status(200)
                .message("Success")
                .desc("Force delete preview generated")
                .object(preview)
                .build();
    }

    @Override
    public ResponseDto<Void> forceDeleteBranch(ForceDeleteConfirmDto dto) {
        if (dto == null || !Boolean.TRUE.equals(dto.getConfirmed())) {
            throw new BusinessException("Confirmation required for force delete", Map.of("confirmed", "You must confirm this action"));
        }
        Integer branchId = dto.getEntityId();
        if (branchId == null || branchId <= 0) {
            throw new BusinessException("Branch ID is required", Map.of("entityId", "ID must be greater than zero"));
        }

        // Serialize branch deletions to enforce the minimum-one-branch invariant under concurrency.
        List<Integer> lockedBranchIds = jdbcTemplate.query(
                "SELECT id FROM branches ORDER BY id LIMIT 1 FOR UPDATE",
                (rs, rowNum) -> rs.getInt("id"));
        if (lockedBranchIds.isEmpty()) {
            throw new BusinessException("Branch not found", null);
        }

        branchRepo.findById(branchId)
                .orElseThrow(() -> new BusinessException("Branch not found with id: " + branchId, null));
        BranchDeleteImpact impact = collectBranchDeleteImpact(branchId);
        if (!impact.blockingReasons().isEmpty()) {
            throw new BusinessException("Cannot delete this branch", Map.of("branch", String.join(" ", impact.blockingReasons())));
        }

        // Only disposable assignments and the untouched zero-balance initializer wallet are removed.
        jdbcTemplate.update("DELETE FROM branch_has_employee WHERE branch_id = ?", branchId);
        jdbcTemplate.update("DELETE FROM company_wallet WHERE " + SAFE_BRANCH_WALLET_FILTER, branchId);
        int deletedRows = jdbcTemplate.update("DELETE FROM branches WHERE id = ?", branchId);
        if (deletedRows != 1) {
            throw new BusinessException("Branch could not be deleted", Map.of("branchId", "Branch no longer exists"));
        }

        return ResponseDto.<Void>builder()
                .status(200)
                .message("Success")
                .desc("Branch deleted; at least one branch remains")
                .build();
    }

    private BranchDeleteImpact collectBranchDeleteImpact(Integer branchId) {
        Map<String, Long> counts = new LinkedHashMap<>();
        long totalBranches = countBranchRows("SELECT COUNT(*) FROM branches");
        long employeeCount = countBranchRows("SELECT COUNT(*) FROM employees WHERE branches_id = ?", branchId);
        long assignmentCount = countBranchRows("SELECT COUNT(*) FROM branch_has_employee WHERE branch_id = ?", branchId);
        long companyWalletCount = countBranchRows("SELECT COUNT(*) FROM company_wallet WHERE branch_id = ?", branchId);
        long initializerWalletCount = countBranchRows("SELECT COUNT(*) FROM company_wallet WHERE " + SAFE_BRANCH_WALLET_FILTER, branchId);
        long financialWalletCount = companyWalletCount - initializerWalletCount;
        long paymentRecordCount = countBranchRows("SELECT COUNT(*) FROM payment_records WHERE branch_id = ?", branchId);
        counts.put("total_branches", totalBranches);
        counts.put("employees", employeeCount);
        counts.put("branch_has_employee", assignmentCount);
        counts.put("company_wallet_rows", companyWalletCount);
        counts.put("empty_initializer_wallet_rows", initializerWalletCount);
        counts.put("financial_wallet_rows", financialWalletCount);
        counts.put("payment_records_preserved", paymentRecordCount);

        List<String> blockers = new ArrayList<>();
        if (totalBranches <= 1) blockers.add("At least one branch must remain; the last branch cannot be deleted.");
        if (employeeCount > 0) blockers.add("Branch has " + employeeCount + " employee(s); reassign them first.");
        if (financialWalletCount > 0) blockers.add("Branch has " + financialWalletCount + " financial wallet record(s); preserve or transfer them first.");
        if (paymentRecordCount > 0) blockers.add("Branch is referenced by " + paymentRecordCount + " payment record(s); payment history is preserved.");

        List<String> rowsToDelete = List.of();
        if (blockers.isEmpty()) {
            rowsToDelete = previewBranchRows(branchId, assignmentCount, initializerWalletCount);
        }
        return new BranchDeleteImpact(counts, blockers, rowsToDelete);
    }

    private long countBranchRows(String sql, Object... args) {
        Long count = jdbcTemplate.queryForObject(sql, Long.class, args);
        return count == null ? 0L : count;
    }

    private List<String> previewBranchRows(Integer branchId, long assignmentCount, long initializerWalletCount) {
        List<String> rows = new ArrayList<>();
        long total = assignmentCount + initializerWalletCount;
        int remaining = MAX_BRANCH_DELETE_PREVIEW_ROWS;
        if (remaining > 0) {
            List<Integer> assignmentIds = jdbcTemplate.query(
                    "SELECT id FROM branch_has_employee WHERE branch_id = ? ORDER BY id LIMIT ?",
                    (rs, rowNum) -> rs.getInt("id"), branchId, remaining);
            assignmentIds.forEach(id -> rows.add("Employee assignment #" + id));
            remaining -= assignmentIds.size();
        }
        if (remaining > 0) {
            List<Integer> walletIds = jdbcTemplate.query(
                    "SELECT id FROM company_wallet WHERE " + SAFE_BRANCH_WALLET_FILTER + " ORDER BY id LIMIT ?",
                    (rs, rowNum) -> rs.getInt("id"), branchId, remaining);
            walletIds.forEach(id -> rows.add("Empty branch wallet initializer #" + id));
        }
        if (total > rows.size()) rows.add("…and " + (total - rows.size()) + " more related record(s)");
        return rows;
    }

    private record BranchDeleteImpact(Map<String, Long> relatedRecordCounts,
                                     List<String> blockingReasons,
                                     List<String> recordsToBeDeleted) {
    }

    private UserEmployeeDto toEmployeeDto(Employee employee) {
        return UserEmployeeDto.builder()
                .id(employee.getId())
                .usersId(employee.getUsers().getId())
                .usersFirstName(employee.getUsers().getFirstName())
                .usersLastName(employee.getUsers().getLastName())
                .usersEmail(employee.getUsers().getEmail())
                .location(employee.getLocation())
                .liveLocation(employee.getLiveLocation())
                .mobile(employee.getMobile())
                .whatsapp(employee.getWhatsapp())
                .build();
    }

    private BranchDto toBranchDto(Branch branch) {
        return new BranchDto(
                branch.getId(),
                branch.getName(),
                branch.getMainLine(),
                branch.getLocation(),
                CommonIdNameDto.builder()
                        .id(branch.getCity().getId())
                        .name(branch.getCity().getName())
                        .build());
    }
}
