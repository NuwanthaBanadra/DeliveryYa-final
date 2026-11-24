import { ArrowPathIcon, ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon, PencilSquareIcon, PlusIcon, TrashIcon, TruckIcon, UserPlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { hasAccess } from '../../util/AccessController';
import axiosInstance from '../../util/AxiosUtil';
import { runSimpleDelete } from '../../util/DeleteFlows';
import { FRONTEND_ACCESS_IDS } from '../../util/FrontendAccess';

/**
 * Manage Third Party Sender
 *
 * Access: THIRD_PARTY_SENDERS (122) opens the screen and allows create / edit
 * (it is also the route guard and the sidebar item); THIRD_PARTY_SENDER_DELETE
 * (123) is needed for the row delete button on top of that.
 *
 * Backend surface (all on OrderController):
 *   POST   /orders/get-third-party-senders   → paginated list (search / searchAddress / searchNote)
 *   POST   /orders/set-third-party-sender    → create
 *   PUT    /orders/update-third-party-sender → update
 *   DELETE /orders/delete-third-party-sender?id= → delete (hard delete; soft flag when orders still point at it)
 */

type ApiResponse<T> = {
  status?: unknown;
  message?: string;
  desc?: string;
  object?: T;
  exData?: T;
};

type SenderApiRecord = {
  id?: number | null;
  name?: string | null;
  address?: string | null;
  note?: string | null;
  nic?: string | null;
  first_mob?: string | null;
  sec_mob?: string | null;
  whatsapp?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type PaginatedSendersObject = {
  pageNumber?: number;
  countPerPage?: number;
  totalCount?: number;
  totalPages?: number;
  items?: SenderApiRecord[];
};

type ThirdPartySender = {
  id: number;
  name: string;
  address: string;
  note: string;
  nic: string;
  firstMob: string;
  secMob: string;
  whatsapp: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type SenderFormState = {
  name: string;
  address: string;
  nic: string;
  firstMob: string;
  secMob: string;
  whatsapp: string;
  note: string;
};

const COUNT_PER_PAGE = 10;

const EMPTY_FORM: SenderFormState = {
  name: '',
  address: '',
  nic: '',
  firstMob: '',
  secMob: '',
  whatsapp: '',
  note: '',
};

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const asNullableText = (value: unknown): string | null => {
  const text = asText(value);
  return text ? text : null;
};

const mapSender = (record: SenderApiRecord): ThirdPartySender | null => {
  const id = typeof record.id === 'number' ? record.id : Number(record.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  return {
    id,
    name: asText(record.name),
    address: asText(record.address),
    note: asText(record.note),
    nic: asText(record.nic),
    firstMob: asText(record.first_mob),
    secMob: asText(record.sec_mob),
    whatsapp: asText(record.whatsapp),
    createdAt: asNullableText(record.createdAt),
    updatedAt: asNullableText(record.updatedAt),
  };
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { desc?: unknown; message?: unknown } } }).response;
    const desc = asText(response?.data?.desc);
    if (desc) return desc;
    const message = asText(response?.data?.message);
    if (message && message.toLowerCase() !== 'error') return message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

const formatDateTime = (value: string | null): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const validateForm = (form: SenderFormState): string | null => {
  if (!form.name.trim()) return 'Sender name is required.';
  if (form.name.trim().length > 100) return 'Sender name must be 100 characters or fewer.';
  if (!form.firstMob.trim()) return 'Primary mobile number is required.';
  if (!form.secMob.trim()) return 'Secondary mobile number is required.';
  if (!form.whatsapp.trim()) return 'WhatsApp number is required.';
  if (form.firstMob.trim().length > 20 || form.secMob.trim().length > 20 || form.whatsapp.trim().length > 20) {
    return 'Mobile numbers must be 20 characters or fewer.';
  }
  if (form.nic.trim().length > 20) return 'NIC must be 20 characters or fewer.';
  if (form.address.trim().length > 100) return 'Address must be 100 characters or fewer.';
  return null;
};

function ThirdPartySenders() {
  // Page (and therefore create / edit) needs THIRD_PARTY_SENDERS; the row
  // delete button is a separate Top-level access.
  const canDeleteSenders = useMemo(
    () => hasAccess(FRONTEND_ACCESS_IDS.THIRD_PARTY_SENDER_DELETE),
    [],
  );
  const [senders, setSenders] = useState<ThirdPartySender[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pageNumber, setPageNumber] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [searchAddress, setSearchAddress] = useState(false);
  const [searchNote, setSearchNote] = useState(false);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingSender, setEditingSender] = useState<ThirdPartySender | null>(null);
  const [form, setForm] = useState<SenderFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
      setPageNumber(0);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadSenders = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const response = await axiosInstance.post<ApiResponse<PaginatedSendersObject>>(
        '/orders/get-third-party-senders',
        {
          pageNumber,
          countPerPage: COUNT_PER_PAGE,
          search: search.trim(),
          searchAddress,
          searchNote,
        },
      );

      const payload = response.data?.object ?? response.data?.exData ?? {};
      const rawItems = Array.isArray(payload.items) ? payload.items : [];
      const mapped = rawItems
        .map(mapSender)
        .filter((sender): sender is ThirdPartySender => sender !== null);

      setSenders(mapped);
      setTotalCount(typeof payload.totalCount === 'number' ? payload.totalCount : mapped.length);
      setTotalPages(
        typeof payload.totalPages === 'number'
          ? payload.totalPages
          : Math.ceil(mapped.length / COUNT_PER_PAGE),
      );
    } catch (error) {
      console.error('Failed to load third party senders:', error);
      setSenders([]);
      setTotalCount(0);
      setTotalPages(0);
      setLoadError(getErrorMessage(error, 'Failed to load third party senders.'));
    } finally {
      setIsLoading(false);
    }
  }, [pageNumber, search, searchAddress, searchNote]);

  useEffect(() => {
    void loadSenders();
  }, [loadSenders]);

  const openCreateForm = () => {
    setEditingSender(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (sender: ThirdPartySender) => {
    setEditingSender(sender);
    setForm({
      name: sender.name,
      address: sender.address,
      nic: sender.nic,
      firstMob: sender.firstMob,
      secMob: sender.secMob,
      whatsapp: sender.whatsapp,
      note: sender.note,
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (isSaving) return;
    setIsFormOpen(false);
  };

  const updateField = (field: keyof SenderFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationError = validateForm(form);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setIsSaving(true);
    setFormError(null);

    const payload = {
      ...(editingSender ? { id: editingSender.id } : {}),
      name: form.name.trim(),
      address: form.address.trim(),
      note: form.note.trim(),
      nic: form.nic.trim(),
      first_mob: form.firstMob.trim(),
      sec_mob: form.secMob.trim(),
      whatsapp: form.whatsapp.trim(),
    };

    try {
      const response = editingSender
        ? await axiosInstance.put<ApiResponse<SenderApiRecord>>('/orders/update-third-party-sender', payload)
        : await axiosInstance.post<ApiResponse<SenderApiRecord>>('/orders/set-third-party-sender', payload);

      const body = response.data;
      const message = asText(body?.message).toLowerCase();
      if (message === 'error' || message === 'failed') {
        throw new Error(asText(body?.desc) || 'The sender could not be saved.');
      }

      setIsFormOpen(false);
      setEditingSender(null);
      setForm(EMPTY_FORM);

      if (!editingSender && pageNumber !== 0) {
        // New rows sort first — jump back to page 0; the effect reloads the list.
        setPageNumber(0);
      } else {
        await loadSenders();
      }
    } catch (error) {
      console.error('Failed to save third party sender:', error);
      setFormError(getErrorMessage(error, 'Failed to save the third party sender. Please try again.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (sender: ThirdPartySender) => {
    await runSimpleDelete({
      title: 'Delete third party sender?',
      itemLabel: 'Third party sender',
      itemName: sender.name || `#${sender.id}`,
      message: 'Orders that already use this sender keep their records.',
      confirmText: 'Delete sender',
      request: () =>
        axiosInstance.delete('/orders/delete-third-party-sender', {
          params: { id: sender.id },
        }),
      successTitle: 'Sender deleted',
      errorTitle: 'Delete failed',
      errorFallback: 'The third party sender could not be deleted. Please try again.',
      onDeleted: () => {
        void loadSenders();
      },
    });
  };

  const pageStart = totalCount === 0 ? 0 : pageNumber * COUNT_PER_PAGE + 1;
  const pageEnd = Math.min(pageNumber * COUNT_PER_PAGE + senders.length, totalCount);
  const notesOnPage = useMemo(() => senders.filter((sender) => sender.note).length, [senders]);
  const withNicOnPage = useMemo(() => senders.filter((sender) => sender.nic).length, [senders]);
  const canGoBack = pageNumber > 0;
  const canGoForward = totalPages > 0 ? pageNumber + 1 < totalPages : senders.length === COUNT_PER_PAGE;

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="bg-linear-to-r from-[#F59B0F] via-[#FF6347] to-[#AC6C2A] bg-clip-text text-3xl font-black text-transparent md:text-4xl">
            Third Party Senders
          </h1>
          <p className="mt-1 text-sm text-gray-600 md:text-base">
            Keep the sender list used when placing orders clean and up to date.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadSenders()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-xl border-2 border-gray-200 bg-white px-4 py-2 font-semibold text-gray-700 transition-all hover:border-[#F59B0F] hover:bg-orange-50 disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex items-center gap-2 rounded-xl bg-linear-to-r from-[#FF6347] to-[#F59B0F] px-4 py-2 font-bold text-white shadow-md shadow-orange-500/25 transition-all hover:opacity-90"
          >
            <PlusIcon className="h-4 w-4" />
            Add sender
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total senders</p>
              <p className="mt-1 text-3xl font-black text-gray-900">{totalCount}</p>
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-[#FF6347] to-[#FF4500] shadow-lg shadow-orange-500/30">
              <TruckIcon className="h-7 w-7 text-white" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">With NIC on this page</p>
              <p className="mt-1 text-3xl font-black text-gray-900">{withNicOnPage}</p>
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-[#F59B0F] to-[#AC6C2A] shadow-lg shadow-amber-500/30">
              <UserPlusIcon className="h-7 w-7 text-white" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">With note on this page</p>
              <p className="mt-1 text-3xl font-black text-gray-900">{notesOnPage}</p>
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-[#AC6C2A] to-[#F59B0F] shadow-lg shadow-amber-700/30">
              <PencilSquareIcon className="h-7 w-7 text-white" />
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm md:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search name, WhatsApp or mobile numbers"
              className="w-full rounded-xl border-2 border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm font-medium text-[#1A1F3A] outline-none transition-colors placeholder:text-gray-400 focus:border-[#F59B0F]"
              aria-label="Search third party senders"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700">
              <input
                type="checkbox"
                checked={searchAddress}
                onChange={(event) => {
                  setSearchAddress(event.target.checked);
                  setPageNumber(0);
                }}
                className="h-4 w-4 rounded border-gray-300 text-[#F59B0F] focus:ring-[#F59B0F]"
              />
              Include address
            </label>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700">
              <input
                type="checkbox"
                checked={searchNote}
                onChange={(event) => {
                  setSearchNote(event.target.checked);
                  setPageNumber(0);
                }}
                className="h-4 w-4 rounded border-gray-300 text-[#F59B0F] focus:ring-[#F59B0F]"
              />
              Include note
            </label>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {loadError}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-200 bg-linear-to-r from-orange-50 to-amber-50">
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-gray-600">Sender</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-gray-600">Mobile numbers</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-gray-600">WhatsApp</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-gray-600">Address</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-gray-600">Note</th>
                <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-wider text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center font-medium text-gray-500">
                    Loading third party senders...
                  </td>
                </tr>
              ) : senders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center font-medium text-gray-500">
                    No third party senders found.
                  </td>
                </tr>
              ) : (
                senders.map((sender) => (
                  <tr key={sender.id} className="transition-colors hover:bg-orange-50/40">
                    <td className="px-4 py-4">
                      <p className="font-bold text-gray-900">{sender.name || '—'}</p>
                      <p className="text-xs font-medium text-gray-500">
                        {sender.nic ? `NIC ${sender.nic}` : 'No NIC'} · Added {formatDateTime(sender.createdAt)}
                      </p>
                    </td>

                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex w-fit items-center rounded-lg bg-orange-50 px-2 py-0.5 text-xs font-semibold text-[#AC6C2A]">
                          {sender.firstMob || '—'}
                        </span>
                        <span className="inline-flex w-fit items-center rounded-lg bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-600">
                          {sender.secMob || '—'}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <span className="inline-flex items-center rounded-lg bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                        {sender.whatsapp || '—'}
                      </span>
                    </td>

                    <td className="max-w-[220px] px-4 py-4 text-sm font-medium text-gray-700">
                      <span className="line-clamp-2">{sender.address || '—'}</span>
                    </td>

                    <td className="max-w-[220px] px-4 py-4 text-sm font-medium text-gray-600">
                      <span className="line-clamp-2">{sender.note || '—'}</span>
                    </td>

                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditForm(sender)}
                          title="Edit sender"
                          aria-label={`Edit ${sender.name}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border-2 border-gray-200 bg-white text-gray-700 transition-all hover:border-[#F59B0F] hover:bg-orange-50"
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                        </button>
                        {canDeleteSenders && (
                          <button
                            type="button"
                            onClick={() => void handleDelete(sender)}
                            title="Delete sender"
                            aria-label={`Delete ${sender.name}`}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border-2 border-red-100 bg-white text-red-600 transition-all hover:border-red-200 hover:bg-red-50"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-gray-600">
            {totalCount === 0 ? 'No senders to show' : `Showing ${pageStart}–${pageEnd} of ${totalCount}`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPageNumber((current) => Math.max(0, current - 1))}
              disabled={!canGoBack || isLoading}
              className="inline-flex items-center gap-1 rounded-lg border-2 border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 transition-all hover:border-[#F59B0F] hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPageNumber((current) => current + 1)}
              disabled={!canGoForward || isLoading}
              className="inline-flex items-center gap-1 rounded-lg border-2 border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 transition-all hover:border-[#F59B0F] hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <Transition appear show={isFormOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={closeForm}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
          </TransitionChild>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <DialogPanel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-2xl transition-all">
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <DialogTitle as="h3" className="text-2xl font-bold text-[#1A1F3A]">
                      {editingSender ? 'Edit third party sender' : 'Add third party sender'}
                    </DialogTitle>
                    <button
                      type="button"
                      onClick={closeForm}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                      aria-label="Close"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label htmlFor="sender-name" className="mb-1 block text-sm font-bold text-gray-700">
                        Sender name <span className="text-[#FF4500]">*</span>
                      </label>
                      <input
                        id="sender-name"
                        type="text"
                        value={form.name}
                        onChange={(event) => updateField('name', event.target.value)}
                        maxLength={100}
                        required
                        className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-medium text-[#1A1F3A] outline-none transition-colors focus:border-[#F59B0F]"
                        placeholder="Name of the person or business sending the parcel"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label htmlFor="sender-first-mob" className="mb-1 block text-sm font-bold text-gray-700">
                          Primary mobile <span className="text-[#FF4500]">*</span>
                        </label>
                        <input
                          id="sender-first-mob"
                          type="tel"
                          value={form.firstMob}
                          onChange={(event) => updateField('firstMob', event.target.value)}
                          maxLength={20}
                          required
                          className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-medium text-[#1A1F3A] outline-none transition-colors focus:border-[#F59B0F]"
                          placeholder="07X XXX XXXX"
                        />
                      </div>
                      <div>
                        <label htmlFor="sender-sec-mob" className="mb-1 block text-sm font-bold text-gray-700">
                          Secondary mobile <span className="text-[#FF4500]">*</span>
                        </label>
                        <input
                          id="sender-sec-mob"
                          type="tel"
                          value={form.secMob}
                          onChange={(event) => updateField('secMob', event.target.value)}
                          maxLength={20}
                          required
                          className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-medium text-[#1A1F3A] outline-none transition-colors focus:border-[#F59B0F]"
                          placeholder="07X XXX XXXX"
                        />
                      </div>
                      <div>
                        <label htmlFor="sender-whatsapp" className="mb-1 block text-sm font-bold text-gray-700">
                          WhatsApp <span className="text-[#FF4500]">*</span>
                        </label>
                        <input
                          id="sender-whatsapp"
                          type="tel"
                          value={form.whatsapp}
                          onChange={(event) => updateField('whatsapp', event.target.value)}
                          maxLength={20}
                          required
                          className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-medium text-[#1A1F3A] outline-none transition-colors focus:border-[#F59B0F]"
                          placeholder="07X XXX XXXX"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="sender-nic" className="mb-1 block text-sm font-bold text-gray-700">
                          NIC
                        </label>
                        <input
                          id="sender-nic"
                          type="text"
                          value={form.nic}
                          onChange={(event) => updateField('nic', event.target.value)}
                          maxLength={20}
                          className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-medium text-[#1A1F3A] outline-none transition-colors focus:border-[#F59B0F]"
                          placeholder="NIC number"
                        />
                      </div>
                      <div>
                        <label htmlFor="sender-address" className="mb-1 block text-sm font-bold text-gray-700">
                          Address
                        </label>
                        <input
                          id="sender-address"
                          type="text"
                          value={form.address}
                          onChange={(event) => updateField('address', event.target.value)}
                          maxLength={100}
                          className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-medium text-[#1A1F3A] outline-none transition-colors focus:border-[#F59B0F]"
                          placeholder="Pickup / sending address"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="sender-note" className="mb-1 block text-sm font-bold text-gray-700">
                        Note
                      </label>
                      <textarea
                        id="sender-note"
                        value={form.note}
                        onChange={(event) => updateField('note', event.target.value)}
                        rows={3}
                        className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-medium text-[#1A1F3A] outline-none transition-colors focus:border-[#F59B0F]"
                        placeholder="Anything the team should know when using this sender"
                      />
                    </div>

                    {formError && (
                      <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                        {formError}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={closeForm}
                        disabled={isSaving}
                        className="rounded-xl border-2 border-gray-200 px-4 py-2 font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isSaving}
                        className="inline-flex items-center gap-2 rounded-xl bg-linear-to-r from-[#FF6347] to-[#F59B0F] px-4 py-2 font-bold text-white shadow-md shadow-orange-500/25 transition-all hover:opacity-90 disabled:opacity-50"
                      >
                        {isSaving ? 'Saving...' : editingSender ? 'Save changes' : 'Add sender'}
                      </button>
                    </div>
                  </form>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}

export default ThirdPartySenders;
