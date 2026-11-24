import React, {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  TrashIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

/**
 * Universal, theme-aligned delete confirmation modal for DeliveryYa.
 *
 * Designed to replace every delete-confirm pattern in the app (raw
 * `Swal.fire` blocks, `swalConfirm`, `window.confirm` and the copy-pasted
 * custom modals). Integration into existing screens is a later step — see
 * `DELETE_CONFIRM_MODAL.md` for the workflow and the backend data contract.
 *
 * Safety features:
 *  - Relational preview: pass the backend force-delete preview as `details`
 *    and the modal lists every related record that will be deleted / detached
 *    together with the main record ("These will be deleted if you delete
 *    this record").
 *  - Type-to-confirm (ON by default): the confirm button stays disabled until
 *    the user types "Delete" themselves — prevents accidental deletions.
 *  - Backend block: when `details.canDelete === false` the confirm button is
 *    locked and the blocking reason is shown.
 *
 * Styling follows the DeliveryYa design system (COLOR_SCHEME.md /
 * UI_DESIGN_SYSTEM_REPORT.md):
 *  - Card: `bg-white rounded-2xl shadow-2xl border-orange-100/70`
 *  - Brand text: `#1A1F3A` (primary) / `#2C3E50` (secondary)
 *  - Danger confirm: red gradient, Warning confirm: `#F59B0F → #AC6C2A`
 *  - Inputs: `border-2 rounded-xl focus:border-[#FF6347] focus:ring-[#FF6347]/15`
 *  - Motion: existing `animate-slideDown` keyframe from `src/index.css`
 *
 * Three ways to use it:
 *
 * 1) Declarative (for components that already manage modal state):
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <DeleteConfirmModal
 *   open={open}
 *   onCancel={() => setOpen(false)}
 *   onConfirm={handleDelete}
 *   title="Delete Product?"
 *   itemName={product.name}
 *   message="This action cannot be undone."
 *   isLoading={isDeleting}
 * />
 * ```
 *
 * 2) Imperative (drop-in replacement for Swal.fire / window.confirm):
 * ```tsx
 * const confirmed = await confirmDelete({
 *   title: 'Delete Product?',
 *   itemName: product.name,
 *   message: 'This action cannot be undone.',
 * });
 * if (!confirmed) return;
 * ```
 *
 * 3) Force delete with relational preview (recommended for records with
 * related data). Fetch the preview from the backend first and pass it as
 * `details` — the user reviews the related records and types "Delete":
 * ```tsx
 * const preview = (await previewForceDeleteProduct(productId)).object!;
 * const confirmed = await confirmDelete({
 *   title: 'Confirm Force Delete',
 *   itemName: preview.entityIdentifier,
 *   itemLabel: preview.entityName,
 *   message: 'This will permanently remove the record and its related data.',
 *   confirmText: 'Yes, permanently delete!',
 *   details: {
 *     canDelete: preview.canDelete,
 *     blockingReason: preview.blockingReason,
 *     relatedRecordCounts: preview.relatedRecordCounts,
 *     recordsToBeDeleted: preview.recordsToBeDeleted,
 *     recordsToBeDetached: preview.recordsToBeDetached,
 *   },
 * });
 * if (!confirmed) return;
 * await forceDeleteProduct({ entityId: productId, confirmed: true });
 * ```
 */

export type DeleteConfirmVariant = 'danger' | 'warning' | 'info';

/**
 * Force-delete preview data — mirrors `ForceDeletePreview` returned by the
 * backend preview endpoints (see `src/util/ForceDeleteUtil.ts` and
 * `DELETE_CONFIRM_MODAL.md` for the full backend contract).
 *
 * The modal renders these so the user can see exactly which relational
 * records will be removed before approving the delete.
 */
export interface DeleteConfirmDetails {
  /** When `false`, the confirm button is locked (backend blocks the delete). */
  canDelete?: boolean;
  /** Shown in a red box — why the delete is blocked (or a backend warning). */
  blockingReason?: string | null;
  /** Related record counts per table, e.g. `{ orders: 3, stocks: 12 }`. */
  relatedRecordCounts?: Record<string, number>;
  /** Relational records that will be permanently deleted with this record. */
  recordsToBeDeleted?: string[];
  /** Records that will be detached (kept, but unlinked). */
  recordsToBeDetached?: string[];
}

export interface DeleteConfirmModalProps {
  /** Controls visibility (declarative usage). */
  open: boolean;
  /** Called when the user cancels, closes or presses Escape. */
  onCancel: () => void;
  /** Called when the user confirms. May be async; pair with `isLoading`. */
  onConfirm: () => void | Promise<void>;
  /** Modal heading. Defaults to "Delete?". */
  title?: string;
  /** Body text under the title. Accepts any React node. */
  message?: React.ReactNode;
  /** Name of the item being deleted — rendered in a highlighted preview box. */
  itemName?: string;
  /** Label shown above `itemName` in the preview box, e.g. "Product". */
  itemLabel?: string;
  /** Confirm button text. Defaults to "Delete". */
  confirmText?: string;
  /** Cancel button text. Defaults to "Cancel". */
  cancelText?: string;
  /**
   * Visual severity:
   * - `danger` (default): red icon + red gradient confirm — permanent deletes.
   * - `warning`: amber icon + amber gradient confirm — disable / cancel actions.
   * - `info`: brand orange icon + brand gradient confirm — soft deletes.
   */
  variant?: DeleteConfirmVariant;
  /** Shows a spinner on the confirm button and disables both buttons. */
  isLoading?: boolean;
  /** Confirm button text while `isLoading`. Defaults to "Deleting…". */
  loadingText?: string;
  /**
   * Type-to-confirm safety gate — prevents accidental deletions.
   * - `true` (default): the user must type "Delete" to enable the confirm button.
   * - `string`: a custom word to type (e.g. the entity name) for stricter checks.
   * - `false`: no gate — only for low-risk, reversible actions.
   */
  requireTypeToConfirm?: string | boolean;
  /** Custom label for the type-to-confirm input. */
  typeToConfirmLabel?: React.ReactNode;
  /**
   * When `true`, the typed word must match exactly (case-sensitive).
   * Default `false` — "delete", "Delete" and "DELETE" all match.
   */
  caseSensitive?: boolean;
  /** Amber warning box rendered above the buttons. */
  warningText?: string;
  /** Force-delete preview (related counts / to-delete / to-detach lists). */
  details?: DeleteConfirmDetails;
  /** Allow closing via backdrop click, X button and Escape. Default true. */
  dismissible?: boolean;
  /** Hide the cancel button (e.g. mandatory acknowledgement). Default false. */
  hideCancel?: boolean;
  /** Card width: `sm` (max-w-sm), `md` (max-w-md, default), `lg` (max-w-lg). */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Stacking order. Default 1050 — above every app modal (they top out at
   * `z-[140]`) and just below SweetAlert2 (1060), so success / error alerts
   * still appear on top.
   */
  zIndex?: number;
}

/** Options for the imperative `confirmDelete()` API. */
export interface ConfirmDeleteOptions
  extends Omit<DeleteConfirmModalProps, 'open' | 'onCancel' | 'onConfirm' | 'isLoading'> {
  /**
   * Optional action run when the user confirms — usually the delete request.
   * The modal stays open with its loading spinner until the action settles,
   * then closes. If the action throws, the promise returned by
   * `confirmDelete()` rejects with that error.
   */
  onConfirm?: () => unknown;
}

/** Word the user must type when `requireTypeToConfirm` is `true`. */
const DEFAULT_CONFIRM_WORD = 'Delete';

/** Above every app modal (max `z-[140]`), below SweetAlert2 (1060). */
const DEFAULT_Z_INDEX = 1050;

/** "payment_records_preserved" → "Payment records preserved". */
const humanizeKey = (key: string): string => {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const VARIANT_STYLES: Record<
  DeleteConfirmVariant,
  {
    iconBg: string;
    iconBorder: string;
    iconText: string;
    icon: React.ComponentType<{ className?: string }>;
    confirmButton: string;
    topBar: string;
  }
> = {
  danger: {
    iconBg: 'bg-red-50',
    iconBorder: 'border-red-100',
    iconText: 'text-red-600',
    icon: TrashIcon,
    confirmButton:
      'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 shadow-red-500/25',
    topBar: 'from-red-500 via-[#FF6347] to-[#FF4500]',
  },
  warning: {
    iconBg: 'bg-amber-50',
    iconBorder: 'border-amber-200',
    iconText: 'text-[#AC6C2A]',
    icon: ExclamationTriangleIcon,
    confirmButton:
      'bg-gradient-to-r from-[#F59B0F] to-[#AC6C2A] hover:from-[#AC6C2A] hover:to-[#8f5a20] shadow-amber-500/25',
    topBar: 'from-[#F59B0F] via-[#FFA500] to-[#AC6C2A]',
  },
  info: {
    iconBg: 'bg-orange-50',
    iconBorder: 'border-orange-100',
    iconText: 'text-[#FF4500]',
    icon: InformationCircleIcon,
    confirmButton:
      'bg-gradient-to-r from-[#FF6347] to-[#FF4500] hover:from-[#FF4500] hover:to-[#e03e00] shadow-orange-500/25',
    topBar: 'from-[#FF6347] via-[#FF7F50] to-[#FF4500]',
  },
};

const SIZE_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  open,
  onCancel,
  onConfirm,
  title = 'Delete?',
  message,
  itemName,
  itemLabel,
  confirmText = 'Delete',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading = false,
  loadingText = 'Deleting…',
  requireTypeToConfirm = true,
  typeToConfirmLabel,
  caseSensitive = false,
  warningText,
  details,
  dismissible = true,
  hideCancel = false,
  size = 'md',
  zIndex = DEFAULT_Z_INDEX,
}) => {
  const styles = VARIANT_STYLES[variant];
  const Icon = styles.icon;
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const typeInputRef = useRef<HTMLInputElement>(null);

  // Unique ids so several (or nested) modals never clash.
  const uid = useId();
  const titleId = `${uid}-title`;
  const messageId = `${uid}-message`;
  const inputId = `${uid}-type-input`;
  const hintId = `${uid}-type-hint`;

  const requiredWord =
    requireTypeToConfirm === true
      ? DEFAULT_CONFIRM_WORD
      : typeof requireTypeToConfirm === 'string' && requireTypeToConfirm.trim()
        ? requireTypeToConfirm.trim()
        : null;

  const [typedWord, setTypedWord] = useState('');
  const typedTrimmed = typedWord.trim();
  const typeConfirmed = !requiredWord
    ? true
    : caseSensitive
      ? typedTrimmed === requiredWord
      : typedTrimmed.toLowerCase() === requiredWord.toLowerCase();
  const typedMatch = typedTrimmed.length > 0 && typeConfirmed;
  const typedMismatch = typedTrimmed.length > 0 && !typeConfirmed;

  // The backend may block the delete (canDelete === false) — keep the
  // confirm button locked and surface the blocking reason instead.
  const blockedByBackend = details?.canDelete === false;
  const blockingMessage =
    details?.blockingReason ||
    (blockedByBackend ? 'This record cannot be deleted right now.' : null);
  const confirmDisabled = isLoading || !typeConfirmed || blockedByBackend;

  // Reset the type-to-confirm field every time the modal opens.
  // (Render-time adjustment — avoids setState-in-effect cascading renders.)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setTypedWord('');
  }

  // Effect event: always sees the latest props, so the keyboard listener
  // below doesn't re-subscribe on every parent render.
  const handleEscape = useEffectEvent(() => {
    if (dismissible && !isLoading) onCancel();
  });

  // Keyboard: Escape cancels, Tab stays inside the modal (focus trap).
  useEffect(() => {
    if (!open) return;

    const trapFocus = (event: KeyboardEvent) => {
      const card = cardRef.current;
      if (!card) return;
      const focusable = Array.from(
        card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !card.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !card.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Swallow Escape so a modal underneath doesn't close at the same time.
        event.stopPropagation();
        handleEscape();
      } else if (event.key === 'Tab') {
        trapFocus(event);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open]);

  // Lock body scroll, set initial focus and restore focus on close — once per open.
  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the type-to-confirm input when present, otherwise the safe
    // action (Cancel) — never the destructive button.
    const focusTimer = window.setTimeout(() => {
      (typeInputRef.current ?? cancelButtonRef.current)?.focus();
    }, 50);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  const handleConfirm = useCallback(() => {
    if (confirmDisabled) return;
    void onConfirm();
  }, [confirmDisabled, onConfirm]);

  if (!open) return null;

  const relatedEntries = details?.relatedRecordCounts
    ? Object.entries(details.relatedRecordCounts)
    : [];
  const recordsToBeDeleted = details?.recordsToBeDeleted ?? [];
  const recordsToBeDetached = details?.recordsToBeDetached ?? [];

  const confirmTitle = blockedByBackend
    ? 'Deletion is blocked'
    : !typeConfirmed && requiredWord
      ? `Type "${requiredWord}" to enable`
      : undefined;

  // Portal to <body> so the overlay always covers the viewport, even when the
  // modal is rendered inside a transformed / overflow-hidden parent.
  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px] px-4 py-6"
      style={{ zIndex }}
      onClick={(event) => {
        event.stopPropagation();
        if (dismissible && !isLoading) onCancel();
      }}
      role="presentation"
    >
      <div
        ref={cardRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        className={`relative flex max-h-full w-full ${SIZE_CLASSES[size]} flex-col overflow-hidden rounded-2xl border border-orange-100/70 bg-white shadow-2xl animate-slideDown`}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Brand / severity accent bar */}
        <div className={`h-1.5 shrink-0 bg-gradient-to-r ${styles.topBar}`} aria-hidden="true" />

        {dismissible && !isLoading && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        )}

        {/* Scrollable body — long relational lists never push the buttons off-screen */}
        <div className="min-h-0 overflow-y-auto px-6 pb-6 pt-5 scrollbar-thin">
          {/* Icon */}
          <div
            className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border ${styles.iconBg} ${styles.iconBorder}`}
          >
            <Icon className={`h-8 w-8 ${styles.iconText}`} />
          </div>

          {/* Title + message */}
          <h3 id={titleId} className="mb-2 text-center text-xl font-bold text-[#1A1F3A]">
            {title}
          </h3>

          {message ? (
            <div
              id={messageId}
              className="mb-4 text-center text-sm leading-relaxed text-[#2C3E50]/85"
            >
              {message}
            </div>
          ) : null}

          {/* Item preview */}
          {itemName ? (
            <div className="mb-4 rounded-xl border border-orange-100 bg-orange-50/70 px-4 py-3 text-center">
              {itemLabel ? (
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#AC6C2A]">
                  {itemLabel}
                </p>
              ) : null}
              <p className="break-words text-sm font-semibold text-[#1A1F3A]">{itemName}</p>
            </div>
          ) : null}

          {/* Backend blocking reason / warning */}
          {blockingMessage ? (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <p className="text-sm font-medium text-red-700">{blockingMessage}</p>
            </div>
          ) : null}

          {/* Relational data: counts per related table */}
          {relatedEntries.length > 0 ? (
            <div className="mb-4 overflow-hidden rounded-xl border border-gray-200">
              <p className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-gray-500">
                Related records found
              </p>
              <div className="max-h-36 overflow-y-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <tbody>
                    {relatedEntries.map(([table, count]) => (
                      <tr key={table} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2 text-gray-600" title={table}>
                          {humanizeKey(table)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right ${
                            Number(count) > 0 ? 'font-semibold text-[#1A1F3A]' : 'text-gray-400'
                          }`}
                        >
                          {count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Relational data: records deleted together with this record */}
          {recordsToBeDeleted.length > 0 ? (
            <div className="mb-4 rounded-xl border border-red-100 bg-red-50/70 px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-red-600">
                  These will be deleted if you delete this record
                </p>
                <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                  {recordsToBeDeleted.length}
                </span>
              </div>
              <ul className="max-h-32 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-gray-700 scrollbar-thin">
                {recordsToBeDeleted.map((record, index) => (
                  <li key={`${record}-${index}`}>{record}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Relational data: records kept but unlinked */}
          {recordsToBeDetached.length > 0 ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#AC6C2A]">
                  These will be detached (kept, but unlinked)
                </p>
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                  {recordsToBeDetached.length}
                </span>
              </div>
              <ul className="max-h-32 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-gray-700 scrollbar-thin">
                {recordsToBeDetached.map((record, index) => (
                  <li key={`${record}-${index}`}>{record}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Warning box */}
          {warningText ? (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-[#AC6C2A]" />
              <p className="text-sm font-medium text-amber-800">{warningText}</p>
            </div>
          ) : null}

          {/* Type-to-confirm gate — prevents accidental deletions */}
          {requiredWord ? (
            <div className="mb-4">
              <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-gray-700">
                {typeToConfirmLabel ?? (
                  <>
                    Type{' '}
                    <span className="rounded-md bg-red-50 px-1.5 py-0.5 font-mono font-bold text-red-600">
                      {requiredWord}
                    </span>{' '}
                    to confirm
                  </>
                )}
              </label>
              <div className="relative">
                <input
                  id={inputId}
                  ref={typeInputRef}
                  type="text"
                  value={typedWord}
                  onChange={(event) => setTypedWord(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      // Never submit a surrounding <form>.
                      event.preventDefault();
                      handleConfirm();
                    }
                  }}
                  placeholder={requiredWord}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={isLoading || blockedByBackend}
                  aria-invalid={typedMismatch}
                  aria-describedby={hintId}
                  className={`w-full rounded-xl border-2 px-3 py-2.5 pr-10 text-sm font-semibold tracking-wide text-[#1A1F3A] placeholder:text-gray-400 focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50 ${
                    typedMatch
                      ? 'border-green-500 focus:border-green-500 focus:ring-green-500/15'
                      : typedMismatch
                        ? 'border-red-300 focus:border-red-400 focus:ring-red-400/15'
                        : 'border-gray-200 focus:border-[#FF6347] focus:ring-[#FF6347]/15'
                  }`}
                />
                {typedMatch ? (
                  <span
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-green-600"
                    aria-hidden="true"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                ) : null}
              </div>
              <p
                id={hintId}
                className={`mt-1.5 text-xs ${
                  blockedByBackend ? 'text-red-600' : typedMatch ? 'text-green-600' : 'text-gray-500'
                }`}
              >
                {blockedByBackend
                  ? 'This record can’t be deleted right now — see the reason above.'
                  : typedMatch
                    ? 'Confirmed — you can now delete.'
                    : `Type "${requiredWord}" to enable the delete button.`}
              </p>
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex gap-3">
            {!hideCancel && (
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={onCancel}
                disabled={isLoading}
                className="flex-1 rounded-xl border-2 border-gray-200 py-2.5 font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelText}
              </button>
            )}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirmDisabled}
              title={confirmTitle}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r py-2.5 font-semibold text-white shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${styles.confirmButton}`}
            >
              {isLoading ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {loadingText}
                </>
              ) : (
                confirmText
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ------------------------------------------------------------ imperative API

/** Themed "checking…" overlay shown while the delete preview loads. */
const DeletePreviewLoader: React.FC<{ text: string }> = ({ text }) => (
  <div
    className="fixed inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px] px-4"
    style={{ zIndex: DEFAULT_Z_INDEX }}
    role="presentation"
  >
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-2xl border border-orange-100/70 bg-white px-5 py-4 shadow-2xl animate-slideDown"
    >
      <span
        className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[#FF6347] border-t-transparent"
        aria-hidden="true"
      />
      <span className="text-sm font-semibold text-[#1A1F3A]">{text}</span>
    </div>
  </div>
);

interface ImperativeHost {
  render: (node: React.ReactNode) => void;
  unmount: () => void;
}

/** A detached React root on <body> for imperatively shown modals. */
const createImperativeHost = (): ImperativeHost => {
  const container = document.createElement('div');
  container.setAttribute('data-delete-confirm-root', 'true');
  document.body.appendChild(container);
  const root = createRoot(container);
  let mounted = true;

  return {
    render: (node) => {
      if (mounted) root.render(node);
    },
    unmount: () => {
      if (!mounted) return;
      mounted = false;
      root.unmount();
      container.remove();
    },
  };
};

/** Renders the modal into `host` and settles the promise exactly once. */
const showConfirmInHost = (
  host: ImperativeHost,
  options: ConfirmDeleteOptions,
  resolve: (confirmed: boolean) => void,
  reject: (error: unknown) => void,
) => {
  const { onConfirm: action, ...modalProps } = options;
  let settled = false;

  const settle = (finish: () => void) => {
    if (settled) return;
    settled = true;
    host.unmount();
    finish();
  };

  const render = (isLoading: boolean) => {
    host.render(
      <DeleteConfirmModal
        {...modalProps}
        open
        isLoading={isLoading}
        onCancel={() => settle(() => resolve(false))}
        onConfirm={async () => {
          if (!action) {
            settle(() => resolve(true));
            return;
          }
          // Keep the modal open with its spinner until the action settles.
          render(true);
          try {
            await action();
          } catch (error) {
            settle(() => reject(error));
            return;
          }
          settle(() => resolve(true));
        }}
      />,
    );
  };

  render(false);
};

/**
 * Imperative API — drop-in replacement for `Swal.fire` confirmations,
 * `swalConfirm` and `window.confirm` in async handlers. Type-to-confirm
 * ("Delete") is on by default; pass `requireTypeToConfirm: false` to skip it.
 *
 * ```tsx
 * const confirmed = await confirmDelete({
 *   title: 'Delete Product?',
 *   itemName: product.name,
 *   message: 'This action cannot be undone.',
 *   // optional: keeps the modal open with a spinner while it runs
 *   onConfirm: () => axiosInstance.delete('/products/delete-product-by-id', { params: { id } }),
 * });
 * if (!confirmed) return;
 * ```
 *
 * @returns `true` when the user confirms (and `onConfirm`, if given,
 * succeeded), `false` when they cancel/close. Rejects if `onConfirm` throws.
 */
// eslint-disable-next-line react-refresh/only-export-components -- intentional: component + imperative helpers share one import path
export function confirmDelete(options: ConfirmDeleteOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    showConfirmInHost(createImperativeHost(), options, resolve, reject);
  });
}

export interface ConfirmDeleteWithPreviewOptions<T> {
  /** Loads what the modal needs first — e.g. the backend force-delete preview. */
  loadPreview: () => Promise<T>;
  /** Builds the modal options from the loaded preview. */
  buildOptions: (preview: T) => ConfirmDeleteOptions;
  /** Text shown while loading. Default "Checking related records…". */
  loadingText?: string;
}

/**
 * Shows a "Checking related records…" overlay while `loadPreview` runs and
 * opens the delete modal only if it succeeds. If loading fails the modal
 * never opens and the promise rejects with the loading error.
 *
 * ```tsx
 * const confirmed = await confirmDeleteWithPreview({
 *   loadPreview: async () => (await previewForceDeleteProduct(id)).object!,
 *   buildOptions: (preview) => ({
 *     title: 'Confirm Force Delete',
 *     itemName: preview.entityIdentifier,
 *     details: preview,
 *     onConfirm: () => forceDeleteProduct({ entityId: preview.entityId, confirmed: true }),
 *   }),
 * });
 * ```
 */
// eslint-disable-next-line react-refresh/only-export-components -- intentional: component + imperative helpers share one import path
export function confirmDeleteWithPreview<T>({
  loadPreview,
  buildOptions,
  loadingText = 'Checking related records…',
}: ConfirmDeleteWithPreviewOptions<T>): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const host = createImperativeHost();
    host.render(<DeletePreviewLoader text={loadingText} />);

    void (async () => {
      let options: ConfirmDeleteOptions;
      try {
        options = buildOptions(await loadPreview());
      } catch (error) {
        host.unmount();
        reject(error);
        return;
      }
      showConfirmInHost(host, options, resolve, reject);
    })();
  });
}

export default DeleteConfirmModal;
