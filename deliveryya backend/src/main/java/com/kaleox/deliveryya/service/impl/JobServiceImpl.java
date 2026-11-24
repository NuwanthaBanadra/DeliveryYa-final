package com.kaleox.deliveryya.service.impl;

import com.kaleox.deliveryya.config.BusinessException;
import com.kaleox.deliveryya.dto.ForceDeleteConfirmDto;
import com.kaleox.deliveryya.dto.ForceDeletePreviewDto;
import com.kaleox.deliveryya.dto.ResponseDto;
import com.kaleox.deliveryya.dto.customDto.CommonIdNameDto;
import com.kaleox.deliveryya.dto.paginatedDto.PaginatedUrgentJobDto;
import com.kaleox.deliveryya.dto.urgent.*;
import com.kaleox.deliveryya.entities.*;
import com.kaleox.deliveryya.repo.*;
import com.kaleox.deliveryya.service.JobService;
import com.kaleox.deliveryya.service.specification.UrgentJobSpec;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@Transactional
@RequiredArgsConstructor
public class JobServiceImpl implements JobService {

    private static final int JOB_CODE_SAVE_ATTEMPTS = 20;

    private final UrgentJobRepo urgentJobRepo;
    private final UrgentJobItemRepo urgentJobItemRepo;
    private final JobStatusRepo jobStatusRepo;
    private final VerificationStatusRepo verificationStatusRepo;
    private final VehicleTypeRepo vehicleTypeRepo;
    private final VehicleRepo vehicleRepo;
    private final PaymentStatusRepo paymentStatusRepo;
    private final PaymentTypeRepo paymentTypeRepo;
    private final AgentJobRepo agentJobRepo;
    private final JdbcTemplate jdbcTemplate;

    @Override
    public ResponseDto<UrgentJobDto> setUrgentJob(SetUrgentJobDto dto) {
        log.info("Creating urgent job: {}", dto.getJob());

        JobStatus jobStatus = jobStatusRepo.findById(1)
                .orElseThrow(() -> new BusinessException("Job status with ID 1 not found. Please configure the system properly.", null));

        // Get VerificationStatus with ID = 1 (default status)
        VerificationStatus verificationStatus = verificationStatusRepo.findById(1)
                .orElseThrow(() -> new BusinessException("Verification status with ID 1 not found. Please configure the system properly.", null));

        VehicleType vehicleType = vehicleTypeRepo.findById(dto.getVehicleTypeId())
                .orElseThrow(() -> new BusinessException("Vehicle type with ID " + dto.getVehicleTypeId() + " not found.", null));

        UrgentJob savedJob = null;
        for (int attempt = 0; attempt < JOB_CODE_SAVE_ATTEMPTS; attempt++) {
            String jobCode = generateJobCode();

            UrgentJob urgentJob = UrgentJob.builder()
                    .job(dto.getJob())
                    .desc(dto.getDesc())
                    .mobile(dto.getMobile())
                    .username(dto.getUsername())
                    .vehicleType(vehicleType)
                    .nic(dto.getNic())
                    .email(dto.getEmail())
                    .jobStatus(jobStatus)
                    .verificationStatus(verificationStatus)
                    .trip(dto.getTrip())
                    .jobCode(jobCode)
                    .build();

            try {
                savedJob = urgentJobRepo.saveAndFlush(urgentJob);
                break;
            } catch (DataIntegrityViolationException ex) {
                // Retry only for duplicate code races between concurrent requests.
                log.warn("Collision while generating urgent job code. Retrying... attempt={}", attempt + 1);
            }
        }

        if (savedJob == null) {
            throw new BusinessException("Could not generate unique job code", null);
        }

        List<UrgentJobItem> jobItems = new ArrayList<>();
        for (UrgentJobItemDto itemDto : dto.getItems()) {
            UrgentJobItem jobItem = UrgentJobItem.builder()
                    .location(itemDto.getLocation())
                    .task(itemDto.getTask())
                    .beAt(itemDto.getBeAt())
                    .expectedTimeDuration(itemDto.getExpectedTimeDuration())
                    .urgentJobs(savedJob)
                    .jobStatus(jobStatus)
                    .build();

            jobItems.add(urgentJobItemRepo.save(jobItem));
        }

        // Build response DTO
        UrgentJobDto responseDto = buildUrgentJobDto(savedJob, jobItems);

        return ResponseDto.<UrgentJobDto>builder()
                .status(200)
                .message("Success")
                .desc("Urgent job created successfully with code: " + savedJob.getJobCode())
                .object(responseDto)
                .build();
    }

    @Override
    public ResponseDto<UrgentJobDto> updateUrgentJob(UpdateUrgentJobDto dto) {
        log.info("Updating urgent job ID: {}", dto.getId());

        UrgentJob urgentJob = urgentJobRepo.findById(dto.getId())
                .orElseThrow(() -> new BusinessException("Urgent job not found with ID: " + dto.getId(), null));

        // Always reset verification status to 1
        VerificationStatus verificationStatus = verificationStatusRepo.findById(1)
                .orElseThrow(() -> new BusinessException("Verification status with ID 1 not found. Please configure the system properly.", null));

        VehicleType vehicleType = null;
        if (dto.getVehicleTypeId() != null) {
            vehicleType = vehicleTypeRepo.findById(dto.getVehicleTypeId())
                    .orElseThrow(() -> new BusinessException("Vehicle type with ID " + dto.getVehicleTypeId() + " not found.", null));
        }

        // Update job fields
        urgentJob.setJob(dto.getJob());
        urgentJob.setDesc(dto.getDesc());
        urgentJob.setMobile(dto.getMobile());
        urgentJob.setUsername(dto.getUsername());
        urgentJob.setNic(dto.getNic());
        urgentJob.setEmail(dto.getEmail());
        urgentJob.setTrip(dto.getTrip());
        urgentJob.setVehicleType(vehicleType);
        urgentJob.setVerificationStatus(verificationStatus);

        UrgentJob savedJob = urgentJobRepo.save(urgentJob);

        // Delete all existing items and re-add them
        urgentJobItemRepo.deleteByUrgentJobs_Id(savedJob.getId());

        JobStatus jobStatus = savedJob.getJobStatus();

        List<UrgentJobItem> jobItems = new ArrayList<>();
        for (UrgentJobItemDto itemDto : dto.getItems()) {
            UrgentJobItem jobItem = UrgentJobItem.builder()
                    .location(itemDto.getLocation())
                    .task(itemDto.getTask())
                    .beAt(itemDto.getBeAt())
                    .expectedTimeDuration(itemDto.getExpectedTimeDuration())
                    .urgentJobs(savedJob)
                    .jobStatus(jobStatus)
                    .build();

            jobItems.add(urgentJobItemRepo.save(jobItem));
        }

        UrgentJobDto responseDto = buildUrgentJobDto(savedJob, jobItems);

        return ResponseDto.<UrgentJobDto>builder()
                .status(200)
                .message("Success")
                .desc("Urgent job updated successfully.")
                .object(responseDto)
                .build();
    }

    @Override
    public ResponseDto<PaginatedUrgentJobDto> getUrgentJobs(PaginatedUrgentJobDto dto) {
        Pageable pageable = PageRequest.of(
                dto.getPageNumber(),
                dto.getCountPerPage(),
                Sort.by("id").descending()
        );

        Specification<UrgentJob> spec = UrgentJobSpec.getUrgentJobSpecification(dto);
        Page<UrgentJob> urgentJobs = urgentJobRepo.findAll(spec, pageable);

        dto.setTotalCount(urgentJobs.getTotalElements());
        dto.setTotalPages(urgentJobs.getTotalPages());
        dto.setCountPerPage(urgentJobs.getSize());

        List<UrgentJob> jobs = urgentJobs.getContent();
        List<Integer> jobIds = jobs.stream().map(UrgentJob::getId).toList();

        Map<Integer, List<UrgentJobItem>> itemsByJobId = new HashMap<>();
        if (!jobIds.isEmpty()) {
            List<UrgentJobItem> allItems = urgentJobItemRepo.findByUrgentJobs_IdIn(jobIds);
            itemsByJobId = allItems.stream()
                    .collect(Collectors.groupingBy(item -> item.getUrgentJobs().getId()));
        }

        Map<Integer, List<UrgentJobItem>> finalItemsByJobId = itemsByJobId;
        List<UrgentJobDto> urgentJobDtos = jobs.stream()
                .map(job -> buildUrgentJobDto(job, finalItemsByJobId.getOrDefault(job.getId(),
                        Collections.emptyList())))
                .toList();

        dto.setItems(urgentJobDtos);

        return ResponseDto.<PaginatedUrgentJobDto>builder()
                .status(200)
                .message("Success")
                .desc("Urgent jobs fetched successfully")
                .object(dto)
                .build();
    }

    @Override
    public ResponseDto<List<CommonIdNameDto>> getJobStatuses(Integer id) {
        List<CommonIdNameDto> statusDtos;

        if (id != null) {
            JobStatus jobStatus = jobStatusRepo.findById(id)
                    .orElseThrow(() -> new BusinessException("Job status not found with id: " + id, null));

            statusDtos = List.of(new CommonIdNameDto(jobStatus.getId(), jobStatus.getName()));
        } else {
            statusDtos = jobStatusRepo.findAll().stream()
                    .map(status -> new CommonIdNameDto(status.getId(), status.getName()))
                    .toList();
        }

        return ResponseDto.<List<CommonIdNameDto>>builder()
                .status(200)
                .message("Success")
                .desc("Job statuses fetched successfully")
                .object(statusDtos)
                .build();
    }

    @Override
    public String deleteUrgentJob(Integer urgentJobId) {
        UrgentJob urgentJob = urgentJobRepo.findById(urgentJobId)
                .orElseThrow(() -> new BusinessException("Urgent job not found with ID: " + urgentJobId, null));
        assertUrgentJobHasNoAcceptedWork(urgentJobId);
        deleteUrgentJobRows(urgentJob);
        return "Urgent job deleted successfully";
    }

    /**
     * A job that an agent has already accepted carries real delivery work (and the agent's records).
     * Deleting it would erase work in progress, so it is blocked for both the normal and the force delete.
     */
    private long acceptedAgentJobCount(Integer urgentJobId) {
        return agentJobRepo.countByUrgentJob_IdAndAcceptedTrue(urgentJobId);
    }

    private void assertUrgentJobHasNoAcceptedWork(Integer urgentJobId) {
        long acceptedCount = acceptedAgentJobCount(urgentJobId);
        if (acceptedCount > 0) {
            throw new BusinessException(
                    "This urgent job cannot be deleted because an agent has already accepted it",
                    Map.of("acceptedAgentJobs", acceptedCount + " agent job(s) are already accepted. Reassign or release them before deleting the job."));
        }
    }

    @Override
    public ResponseDto<ForceDeletePreviewDto> previewForceDeleteUrgentJob(Integer urgentJobId) {
        if (urgentJobId == null || urgentJobId <= 0) {
            throw new BusinessException("Urgent job ID is required", Map.of("urgentJobId", "ID must be greater than zero"));
        }
        UrgentJob urgentJob = urgentJobRepo.findById(urgentJobId)
                .orElseThrow(() -> new BusinessException("Urgent job not found with ID: " + urgentJobId, null));
        Map<String, Long> counts = urgentJobDeleteCounts(urgentJob);
        long acceptedAgentJobs = acceptedAgentJobCount(urgentJobId);
        counts.put("agent_jobs_accepted", acceptedAgentJobs);
        List<String> relatedRows = previewUrgentJobRows(urgentJob, counts);
        boolean canDelete = acceptedAgentJobs == 0L;
        ForceDeletePreviewDto preview = ForceDeletePreviewDto.builder()
                .entityName("Urgent Job")
                .entityId(urgentJobId)
                .entityIdentifier(urgentJob.getJobCode() + " — " + urgentJob.getJob())
                .canDelete(canDelete)
                .blockingReason(canDelete ? null
                        : "An agent has already accepted this job (" + acceptedAgentJobs
                        + " accepted agent job(s)). Reassign or release the accepted work before deleting it.")
                .relatedRecordCounts(counts)
                .recordsToBeDeleted(relatedRows)
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
    public ResponseDto<Void> forceDeleteUrgentJob(ForceDeleteConfirmDto dto) {
        if (dto == null || !Boolean.TRUE.equals(dto.getConfirmed())) {
            throw new BusinessException("Confirmation required for force delete", Map.of("confirmed", "You must confirm this action"));
        }
        Integer urgentJobId = dto.getEntityId();
        if (urgentJobId == null || urgentJobId <= 0) {
            throw new BusinessException("Urgent job ID is required", Map.of("entityId", "ID must be greater than zero"));
        }
        UrgentJob urgentJob = urgentJobRepo.findById(urgentJobId)
                .orElseThrow(() -> new BusinessException("Urgent job not found with ID: " + urgentJobId, null));
        assertUrgentJobHasNoAcceptedWork(urgentJobId);
        // Delete operational children only; payment history is never touched.
        deleteUrgentJobRows(urgentJob);
        return ResponseDto.<Void>builder()
                .status(200)
                .message("Success")
                .desc("Urgent job and operational records deleted; payment records preserved")
                .build();
    }

    private Map<String, Long> urgentJobDeleteCounts(UrgentJob urgentJob) {
        Integer id = urgentJob.getId();
        String code = urgentJob.getJobCode();
        Map<String, Long> counts = new LinkedHashMap<>();
        counts.put("urgent_job_items", countUrgentJobRows("SELECT COUNT(*) FROM urgent_job_items WHERE urgent_jobs_id = ?", id));
        counts.put("agent_jobs", countUrgentJobRows("SELECT COUNT(*) FROM agent_jobs WHERE urgent_jobs_id = ?", id));
        counts.put("agent_job_tasks", countUrgentJobRows("SELECT COUNT(*) FROM agent_job_tasks WHERE agent_job_id IN (SELECT id FROM agent_jobs WHERE urgent_jobs_id = ?)", id));
        counts.put("payment_record_items_preserved", countUrgentJobRows("SELECT COUNT(*) FROM payment_record_items WHERE code = ?", code));
        counts.put("payment_records_preserved", countUrgentJobRows("SELECT COUNT(DISTINCT payment_record_id) FROM payment_record_items WHERE code = ?", code));
        return counts;
    }

    private long countUrgentJobRows(String sql, Object... args) {
        Long count = jdbcTemplate.queryForObject(sql, Long.class, args);
        return count == null ? 0L : count;
    }

    private List<String> previewUrgentJobRows(UrgentJob urgentJob, Map<String, Long> counts) {
        List<String> rows = new ArrayList<>();
        long total = counts.getOrDefault("agent_job_tasks", 0L) + counts.getOrDefault("agent_jobs", 0L)
                + counts.getOrDefault("urgent_job_items", 0L);
        int remaining = 50;
        remaining -= appendUrgentJobIds(rows, "Agent job task",
                "SELECT t.id FROM agent_job_tasks t JOIN agent_jobs a ON a.id = t.agent_job_id WHERE a.urgent_jobs_id = ? ORDER BY t.id LIMIT ?",
                remaining, urgentJob.getId());
        remaining -= appendUrgentJobIds(rows, "Agent job",
                "SELECT id FROM agent_jobs WHERE urgent_jobs_id = ? ORDER BY id LIMIT ?", remaining, urgentJob.getId());
        appendUrgentJobIds(rows, "Urgent job item",
                "SELECT id FROM urgent_job_items WHERE urgent_jobs_id = ? ORDER BY id LIMIT ?", remaining, urgentJob.getId());
        if (total > rows.size()) rows.add("…and " + (total - rows.size()) + " more related record(s)");
        return rows;
    }

    private int appendUrgentJobIds(List<String> rows, String label, String sql, int limit, Object id) {
        if (limit <= 0) return 0;
        List<Integer> ids = jdbcTemplate.query(sql, (rs, rowNum) -> rs.getInt("id"), id, limit);
        ids.forEach(rowId -> rows.add(label + " #" + rowId));
        return ids.size();
    }

    private void deleteUrgentJobRows(UrgentJob urgentJob) {
        Integer id = urgentJob.getId();
        jdbcTemplate.update("DELETE FROM agent_job_tasks WHERE agent_job_id IN (SELECT id FROM agent_jobs WHERE urgent_jobs_id = ?)", id);
        jdbcTemplate.update("DELETE FROM agent_jobs WHERE urgent_jobs_id = ?", id);
        jdbcTemplate.update("DELETE FROM urgent_job_items WHERE urgent_jobs_id = ?", id);
        int deleted = jdbcTemplate.update("DELETE FROM urgent_jobs WHERE id = ?", id);
        if (deleted != 1) {
            throw new BusinessException("Urgent job could not be deleted", Map.of("urgentJobId", "Job no longer exists"));
        }
    }

    @Override
    public String updateUrgentJobConfidentialData(CUrgentJobDto cUrgentJobDto) {
        UrgentJob urgentJob;
        if (cUrgentJobDto.getId() != null && cUrgentJobDto.getId() > 0) {
            urgentJob = urgentJobRepo.findById(cUrgentJobDto.getId())
                    .orElseThrow(() -> new BusinessException("Urgent job not found with ID: " + cUrgentJobDto.getId(), null));
        } else if (cUrgentJobDto.getJobCode() != null && !cUrgentJobDto.getJobCode().trim().isEmpty()) {
            urgentJob = urgentJobRepo.findByJobCode(cUrgentJobDto.getJobCode())
                    .orElseThrow(() -> new BusinessException("Urgent job not found with code: " + cUrgentJobDto.getJobCode(), null));
        } else {
            throw new BusinessException("Either Job ID or Job Code is required and must be valid", null);
        }

        if (cUrgentJobDto.getTrip() != null) {
            urgentJob.setTrip(cUrgentJobDto.getTrip());
        }

        if (cUrgentJobDto.getCost() != null) {
            urgentJob.setCost(cUrgentJobDto.getCost());
        }

        if (cUrgentJobDto.getMessage() != null) {
            urgentJob.setMessage(cUrgentJobDto.getMessage());
        }

        if (cUrgentJobDto.getJobStatusId() != null && cUrgentJobDto.getJobStatusId() > 0) {
            urgentJob.setJobStatus(jobStatusRepo.findById(cUrgentJobDto.getJobStatusId())
                    .orElseThrow(() -> new BusinessException(
                            "Job status not found with ID: " + cUrgentJobDto.getJobStatusId(), null)));
        }

        if (cUrgentJobDto.getVehicleId() != null && cUrgentJobDto.getVehicleId() > 0) {
            urgentJob.setVehicle(vehicleRepo.findById(cUrgentJobDto.getVehicleId())
                    .orElseThrow(() -> new BusinessException(
                            "Vehicle not found with ID: " + cUrgentJobDto.getVehicleId(), null)));
        }

        if (cUrgentJobDto.getVehicleTypeId() != null && cUrgentJobDto.getVehicleTypeId() > 0) {
            urgentJob.setVehicleType(vehicleTypeRepo.findById(cUrgentJobDto.getVehicleTypeId())
                    .orElseThrow(() -> new BusinessException(
                            "Vehicle type not found with ID: " + cUrgentJobDto.getVehicleTypeId(), null)));
        }

        if (cUrgentJobDto.getVerificationStatusId() != null && cUrgentJobDto.getVerificationStatusId() > 0) {
            urgentJob.setVerificationStatus(verificationStatusRepo.findById(cUrgentJobDto.getVerificationStatusId())
                    .orElseThrow(() -> new BusinessException(
                            "Verification status not found with ID: " + cUrgentJobDto.getVerificationStatusId(), null)));
        }

        if (cUrgentJobDto.getPaymentStatusId() != null && cUrgentJobDto.getPaymentStatusId() > 0) {
            urgentJob.setPaymentStatus(paymentStatusRepo.findById(cUrgentJobDto.getPaymentStatusId())
                    .orElseThrow(() -> new BusinessException(
                            "Payment status not found with ID: " + cUrgentJobDto.getPaymentStatusId(), null)));
        }

        if (cUrgentJobDto.getPaymentTypeId() != null && cUrgentJobDto.getPaymentTypeId() > 0) {
            urgentJob.setPaymentType(paymentTypeRepo.findById(cUrgentJobDto.getPaymentTypeId())
                    .orElseThrow(() -> new BusinessException(
                            "Payment type not found with ID: " + cUrgentJobDto.getPaymentTypeId(), null)));
        }

        urgentJobRepo.save(urgentJob);

        return "Urgent job confidential data updated successfully.";
    }

    /**
     * Generate unique job code in format UJC-0001, UJC-0002, etc.
     */
    private String generateJobCode() {
        int nextNumber = Optional.ofNullable(urgentJobRepo.findMaxJobCodeSequence()).orElse(0) + 1;
        return String.format("UJC-%04d", nextNumber);
    }

    /**
     * Build UrgentJobDto from entity
     */
    private UrgentJobDto buildUrgentJobDto(UrgentJob urgentJob, List<UrgentJobItem> jobItems) {
        List<UrgentJobItemDto> itemDtos = jobItems.stream()
                .map(item -> UrgentJobItemDto.builder()
                        .id(item.getId())
                        .location(item.getLocation())
                        .task(item.getTask())
                        .beAt(item.getBeAt())
                        .expectedTimeDuration(item.getExpectedTimeDuration())
                        .spentDuration(item.getSpentDuration())
                        .build())
                .toList();

        return new UrgentJobDto(
                urgentJob.getId(),
                urgentJob.getJob(),
                urgentJob.getDesc(),
                urgentJob.getMobile(),
                urgentJob.getUsername(),
                urgentJob.getNic(),
                urgentJob.getEmail(),
                urgentJob.getVehicle() != null ?
                        new CommonIdNameDto(urgentJob.getVehicle().getId(), urgentJob.getVehicle().getName()) : null,
                urgentJob.getVehicleType() != null ?
                        new CommonIdNameDto(urgentJob.getVehicleType().getId(), urgentJob.getVehicleType().getName()) : null,
                new CommonIdNameDto(urgentJob.getJobStatus().getId(), urgentJob.getJobStatus().getName()),
                new CommonIdNameDto(urgentJob.getVerificationStatus().getId(), urgentJob.getVerificationStatus().getName()),
                urgentJob.getCost(),
                urgentJob.getTrip(),
                urgentJob.getJobCode(),
                urgentJob.getCreatedAt(),
                urgentJob.getCreatedBy(),
                urgentJob.getUpdatedAt(),
                urgentJob.getUpdatedBy(),
                itemDtos
        );
    }
}


