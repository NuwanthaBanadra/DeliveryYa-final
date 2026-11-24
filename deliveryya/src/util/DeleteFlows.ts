import type { ReactNode } from 'react';
import { isAxiosRequestError, isRequestCanceled } from './AxiosUtil';
import {
  confirmDelete,
  confirmDeleteWithPreview,
  type ConfirmDeleteOptions,
} from '../components/DeleteConfirmModal';
import {
  FORCE_DELETE_ROUTES,
  forceDelete,
  previewForceDelete,
  type ForceDeleteEntity,
  type ForceDeletePreview,
} from './ForceDeleteUtil';
import { swalAlert, swalErrorModal } from './SwalUtil';

/**
 * Delete flows used by every page — one place for the confirm → request →
 * feedback → refresh sequence (see DELETE_CONFIRM_MODAL.md).
 *
 * - `runForceDelete`  — preview related records, type "Delete", force delete.
 * - `runSimpleDelete` — type "Delete", then run a simple (hard or soft) delete.
 */

// ------------------------------------------------------------ API helpers

type ResponseBody = {
  status?: unknown;
  message?: unknown;
  desc?: unknown;
  exData?: unknown;
};

/** Statuses for which AxiosUtil's response interceptor already shows a popup. */
const INTERCEPTOR_HANDLED_STATUSES = new Set([401, 403, 460, 500]);

/** Body `message` values the backend uses for failures. */
const FAILURE_MESSAGES = new Set(['error', 'failed', 'fail', 'failure']);

/** Generic body `message` values that make poor user-facing text. */
const GENERIC_MESSAGES = new Set([...FAILURE_MESSAGES, 'success', 'ok']);

const asBody = (value: unknown): ResponseBody | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as ResponseBody) : null;

const nonEmptyText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Error raised when an HTTP 2xx response body reports a failure. */
export class ApiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiResponseError';
  }
}

/** Best human-readable message in a backend `ResponseDto` body. */
const getBodyMessage = (data: unknown): string | undefined => {
  const body = asBody(data);
  if (!body) return nonEmptyText(data);

  const desc = nonEmptyText(body.desc);
  if (desc) return desc;

  const exData = body.exData;
  if (exData && typeof exData === 'object' && !Array.isArray(exData)) {
    const firstDetail = Object.values(exData as Record<string, unknown>)
      .map(nonEmptyText)
      .find(Boolean);
    if (firstDetail) return firstDetail;
  }
  const exText = nonEmptyText(exData);
  if (exText) return exText;

  const message = nonEmptyText(body.message);
  if (message && !GENERIC_MESSAGES.has(message.toLowerCase())) return message;

  return undefined;
};

/** `desc` of a successful response — the backend's success message. */
const getSuccessDesc = (data: unknown): string | undefined => {
  const desc = nonEmptyText(asBody(data)?.desc);
  return desc && !GENERIC_MESSAGES.has(desc.toLowerCase()) ? desc : undefined;
};

/** True when the AxiosUtil interceptor already showed a popup for this error. */
export const isHandledByInterceptor = (error: unknown): boolean => {
  if (isRequestCanceled(error)) return true;
  if (!isAxiosRequestError(error)) return false;
  return INTERCEPTOR_HANDLED_STATUSES.has(error.response?.status ?? -1);
};

/** User-facing message for a failed request (backend `desc` first). */
export const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof ApiResponseError) return error.message;
  if (isAxiosRequestError(error)) {
    const fromBody = getBodyMessage(error.response?.data);
    if (fromBody) return fromBody;
    if (!error.response) return 'Network error — check your connection and try again.';
    return fallback;
  }
  if (error instanceof Error && nonEmptyText(error.message)) return error.message;
  return fallback;
};

/**
 * True unless an HTTP 2xx body reports a failure: a numeric `status` outside
 * 2xx or a `message` of "Error" / "Failed".
 */
export const isApiSuccess = (data: unknown): boolean => {
  const body = asBody(data);
  if (!body) return true;
  if (typeof body.status === 'number' && (body.status < 200 || body.status > 299)) return false;
  const message = nonEmptyText(body.message)?.toLowerCase();
  return !(message && FAILURE_MESSAGES.has(message));
};

/** Throws `ApiResponseError` when `isApiSuccess(data)` is false. */
export const assertApiSuccess = (data: unknown, fallback: string): void => {
  if (!isApiSuccess(data)) {
    throw new ApiResponseError(getBodyMessage(data) ?? fallback);
  }
};

/** Accepts an axios response or a plain body and returns the body. */
const unwrapBody = (result: unknown): unknown => {
  if (
    result &&
    typeof result === 'object' &&
    'data' in result &&
    'status' in result &&
    'headers' in result &&
    'config' in result
  ) {
    return (result as { data: unknown }).data;
  }
  return result;
};

/** Defensive copy so the modal never receives malformed preview data. */
const normalizePreview = (preview: ForceDeletePreview, requestedId: number): ForceDeletePreview => ({
  entityName: nonEmptyText(preview.entityName) ?? '',
  entityId:
    typeof preview.entityId === 'number' && Number.isFinite(preview.entityId) && preview.entityId > 0
      ? preview.entityId
      : requestedId,
  entityIdentifier: nonEmptyText(preview.entityIdentifier) ?? '',
  canDelete: preview.canDelete !== false,
  blockingReason: nonEmptyText(preview.blockingReason) ?? null,
  relatedRecordCounts:
    preview.relatedRecordCounts && typeof preview.relatedRecordCounts === 'object'
      ? preview.relatedRecordCounts
      : {},
  recordsToBeDeleted: Array.isArray(preview.recordsToBeDeleted)
    ? preview.recordsToBeDeleted.map(String)
    : [],
  recordsToBeDetached: Array.isArray(preview.recordsToBeDetached)
    ? preview.recordsToBeDetached.map(String)
    : [],
});

/** Runs a page callback (list refresh) without letting it break the flow. */
const runCallback = async (callback: (() => unknown) | undefined, label: string) => {
  if (!callback) return;
  try {
    await callback();
  } catch (error) {
    console.error(`Delete flow ${label} callback failed:`, error);
  }
};

/** One delete flow at a time — ignores rapid double clicks. */
let flowActive = false;

// ------------------------------------------------------------ force delete

export interface RunForceDeleteOptions {
  /** Entity with a preview / force-delete endpoint pair. */
  entity: ForceDeleteEntity;
  /** Id of the record to delete. */
  entityId: number;
  /** Modal title. Default "Confirm Force Delete". */
  title?: string;
  /** Body text under the title. */
  message?: ReactNode;
  /** Confirm button text. Default "Yes, permanently delete!". */
  confirmText?: string;
  /** Label above the item name. Default: the preview's `entityName`. */
  itemLabel?: string;
  /** Shown when the preview has no `entityIdentifier`. */
  fallbackItemName?: string;
  /** Optional amber warning box above the buttons. */
  warningText?: string;
  /** Success toast title. Default "<Entity> deleted". */
  successTitle?: string;
  /** Success toast text. Default: the backend `desc`. */
  successMessage?: string;
  /** Runs after a successful delete — refresh the list here. */
  onDeleted?: () => unknown;
  /** Runs after the delete request fails — refresh the list here. */
  onFailed?: () => unknown;
}

/**
 * Preview → typed confirmation → permanent delete.
 *
 * 1. Shows "Checking related records…" and loads the backend preview.
 *    A preview failure shows an error and never opens the modal.
 * 2. Opens the modal with the related records (to delete / to detach /
 *    counts). `canDelete: false` locks it and shows the blocking reason.
 * 3. The user types "Delete"; the force-delete request runs with the modal
 *    showing its spinner. The backend re-validates in the transaction.
 * 4. Success → toast + `onDeleted()`. Failure → backend message +
 *    `onFailed()` (refresh) — the record is never treated as deleted.
 *
 * @returns `true` only when the record was deleted.
 */
export async function runForceDelete(options: RunForceDeleteOptions): Promise<boolean> {
  const route = FORCE_DELETE_ROUTES[options.entity];
  const noun = route.label.toLowerCase();

  if (!Number.isFinite(options.entityId) || options.entityId < 1) {
    void swalErrorModal('Delete unavailable', `Invalid ${noun} selected.`);
    return false;
  }
  if (flowActive) return false;
  flowActive = true;

  // Assigned inside the modal's confirm action, so keep the full union type.
  let stage = 'preview' as 'preview' | 'delete';
  let successDesc: string | undefined;
  let confirmed = false;

  try {
    confirmed = await confirmDeleteWithPreview<ForceDeletePreview>({
      loadPreview: async () => {
        const response = await previewForceDelete(options.entity, options.entityId);
        assertApiSuccess(response, `The ${noun} delete preview could not be loaded.`);
        if (!response?.object) {
          throw new ApiResponseError('The delete preview was missing.');
        }
        return normalizePreview(response.object, options.entityId);
      },
      buildOptions: (preview) => ({
        title: options.title ?? 'Confirm Force Delete',
        itemName: preview.entityIdentifier || options.fallbackItemName,
        itemLabel: options.itemLabel ?? (preview.entityName || route.label),
        message:
          options.message ??
          `This permanently deletes the ${noun} and the related records listed below.`,
        confirmText: options.confirmText ?? 'Yes, permanently delete!',
        warningText: options.warningText,
        details: preview,
        onConfirm: async () => {
          stage = 'delete';
          const result = await forceDelete(options.entity, {
            entityId: preview.entityId,
            confirmed: true,
          });
          assertApiSuccess(result, `The ${noun} could not be deleted.`);
          successDesc = getSuccessDesc(result);
        },
      }),
    });
  } catch (error) {
    flowActive = false;
    if (stage === 'preview') {
      console.error(`Failed to load the ${noun} delete preview:`, error);
      if (!isHandledByInterceptor(error)) {
        void swalErrorModal(
          'Delete preview unavailable',
          getApiErrorMessage(
            error,
            `We couldn't check what will be deleted with this ${noun}. Nothing was deleted.`,
          ),
        );
      }
    } else {
      console.error(`Failed to delete the ${noun}:`, error);
      if (!isHandledByInterceptor(error)) {
        void swalErrorModal(
          'Delete failed',
          getApiErrorMessage(error, `The ${noun} could not be deleted. Please try again.`),
        );
      }
      await runCallback(options.onFailed, 'onFailed');
    }
    return false;
  }

  flowActive = false;
  if (!confirmed) return false;

  void swalAlert(
    options.successTitle ?? `${route.label} deleted`,
    options.successMessage ?? successDesc ?? `The ${noun} was permanently deleted.`,
    'success',
  );
  await runCallback(options.onDeleted, 'onDeleted');
  return true;
}

// ------------------------------------------------------------ simple delete

export interface RunSimpleDeleteOptions extends Omit<ConfirmDeleteOptions, 'onConfirm'> {
  /**
   * The delete request. Return the axios response (or its body) so a failure
   * reported in an HTTP 2xx body is detected too.
   */
  request: () => Promise<unknown>;
  /** Success toast title. Default "Deleted". */
  successTitle?: string;
  /** Success toast text. Default: the backend `desc`. */
  successMessage?: string;
  /** Error popup title. Default "Delete failed". */
  errorTitle?: string;
  /** Error text when the backend sends no message. */
  errorFallback?: string;
  /** Runs after a successful delete — update / refresh the list here. */
  onDeleted?: () => unknown;
  /** Runs after the request fails — refresh the list here if useful. */
  onFailed?: () => unknown;
}

/**
 * Typed confirmation → simple delete (no relational preview). Use for hard
 * deletes without dependants (complaint, delivery fee, discount) and for soft
 * deletes (user request, catalog soft delete) — keep the modal copy
 * consistent with the endpoint semantics.
 *
 * @returns `true` only when the request succeeded.
 */
export async function runSimpleDelete(options: RunSimpleDeleteOptions): Promise<boolean> {
  const {
    request,
    successTitle,
    successMessage,
    errorTitle,
    errorFallback,
    onDeleted,
    onFailed,
    ...modalOptions
  } = options;

  if (flowActive) return false;
  flowActive = true;

  const fallback = errorFallback ?? 'The record could not be deleted. Please try again.';
  let successDesc: string | undefined;
  let confirmed = false;

  try {
    confirmed = await confirmDelete({
      ...modalOptions,
      onConfirm: async () => {
        const body = unwrapBody(await request());
        assertApiSuccess(body, fallback);
        successDesc = getSuccessDesc(body);
      },
    });
  } catch (error) {
    flowActive = false;
    console.error('Delete request failed:', error);
    if (!isHandledByInterceptor(error)) {
      void swalErrorModal(errorTitle ?? 'Delete failed', getApiErrorMessage(error, fallback));
    }
    await runCallback(onFailed, 'onFailed');
    return false;
  }

  flowActive = false;
  if (!confirmed) return false;

  void swalAlert(
    successTitle ?? 'Deleted',
    successMessage ?? successDesc ?? 'The record was deleted.',
    'success',
  );
  await runCallback(onDeleted, 'onDeleted');
  return true;
}
