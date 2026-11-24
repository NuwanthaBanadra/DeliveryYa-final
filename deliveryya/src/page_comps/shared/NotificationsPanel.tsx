import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { ArrowTopRightOnSquareIcon, ArrowsPointingOutIcon, BellIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Fragment, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveNotificationPath } from '../../util/NotificationNavigation';

export type NotificationItem = {
  id: number;
  title: string;
  message: string;
  isRead: boolean;
  userId: number;
  /** Optional in-app route stored by the backend (e.g. "/manage-users"). */
  navigateTo?: string | null;
};

interface NotificationsPanelProps {
  isOpen: boolean;
  notificationCount: number;
  notifications: NotificationItem[];
  notificationsLoading: boolean;
  notificationsError: string;
  markingReadId: number | null;
  selectedNotification: NotificationItem | null;
  onToggle: () => void;
  onClose: () => void;
  onRetry: () => void;
  onOpenNotification: (notification: NotificationItem) => void;
  /** Marks a notification as read without opening the detail modal (used before navigating). */
  onMarkRead: (notification: NotificationItem) => void;
  onCloseSelectedNotification: () => void;
}

function NotificationsPanel({
  isOpen,
  notificationCount,
  notifications,
  notificationsLoading,
  notificationsError,
  markingReadId,
  selectedNotification,
  onToggle,
  onClose,
  onRetry,
  onOpenNotification,
  onMarkRead,
  onCloseSelectedNotification,
}: NotificationsPanelProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isExpandedOpen, setIsExpandedOpen] = useState(false);

  /**
   * One click behaviour for both views:
   * - notification has a route → mark read, close everything, navigate there;
   * - no route + small list → open the notification detail modal (as before);
   * - no route + wide modal → just mark it read (the full message is already visible).
   */
  const markReadIfNeeded = (notification: NotificationItem) => {
    if (!notification.isRead) {
      onMarkRead(notification);
    }
  };

  const activateNotification = (notification: NotificationItem, source: 'panel' | 'expanded') => {
    const target = resolveNotificationPath(notification.navigateTo, location.pathname);

    if (target) {
      markReadIfNeeded(notification);
      setIsExpandedOpen(false);
      onClose();
      navigate(target);
      return;
    }

    if (source === 'expanded') {
      markReadIfNeeded(notification);
      return;
    }

    onOpenNotification(notification);
  };

  const openExpandedModal = () => {
    setIsExpandedOpen(true);
    onClose();
  };

  const closeExpandedModal = () => setIsExpandedOpen(false);

  const renderReadBadge = (notification: NotificationItem) => {
    if (markingReadId === notification.id) {
      return (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-gray-400 border-t-transparent" />
          Updating
        </span>
      );
    }

    if (notification.isRead) {
      return (
        <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
          Read
        </span>
      );
    }

    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-[#F59B0F]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#AC6C2A]">
        New
      </span>
    );
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={isOpen}
        className="relative p-2 rounded-lg hover:bg-orange-50 text-gray-600 hover:text-[#F59B0F] transition-all duration-300 group"
      >
        <BellIcon className="h-6 w-6" />
        {notificationCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-linear-to-r from-[#F59B0F] to-[#AC6C2A] text-white text-xs font-bold rounded-full h-5 min-w-5 px-1 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
            {notificationCount > 99 ? '99+' : notificationCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <button
            type="button"
            aria-label="Close notifications panel"
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/20 sm:hidden"
          />
          <div className="fixed top-18 left-2 right-2 z-50 max-h-[calc(100vh-5.5rem)] overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl sm:absolute sm:top-full sm:left-auto sm:right-0 sm:mt-3 sm:w-88 sm:max-h-none sm:max-w-[calc(100vw-1rem)]">
            <div className="bg-linear-to-r from-[#F59B0F] to-[#AC6C2A] px-4 py-3 text-white">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] sm:text-sm font-semibold uppercase tracking-[0.12em] sm:tracking-[0.2em] text-orange-50">
                    Notifications
                  </p>
                  <p className="text-base font-bold">Latest updates</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">{notificationCount}</span>
                  <button
                    type="button"
                    onClick={openExpandedModal}
                    title="View all notifications"
                    aria-label="View all notifications"
                    className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-white/25"
                  >
                    <ArrowsPointingOutIcon className="h-3.5 w-3.5" />
                    View all
                  </button>
                </div>
              </div>
            </div>

            <div className="max-h-[calc(100vh-10rem)] overflow-y-auto sm:max-h-96">
              {notificationsLoading ? (
                <div className="flex items-center justify-center gap-3 px-4 py-10 text-sm text-gray-500">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#F59B0F] border-t-transparent"></span>
                  Loading notifications...
                </div>
              ) : notificationsError ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm font-medium text-gray-700">{notificationsError}</p>
                  <button
                    type="button"
                    onClick={onRetry}
                    className="mt-4 inline-flex items-center justify-center rounded-lg bg-orange-50 px-4 py-2 text-sm font-semibold text-[#AC6C2A] transition-colors hover:bg-orange-100"
                  >
                    Retry
                  </button>
                </div>
              ) : notifications.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-orange-50 text-[#F59B0F]">
                    <BellIcon className="h-6 w-6" />
                  </div>
                  <p className="text-sm font-semibold text-gray-700">No notifications yet</p>
                  <p className="mt-1 text-xs text-gray-500">New updates will appear here.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {notifications.map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => {
                        activateNotification(notification, 'panel');
                      }}
                      className={`w-full text-left flex items-start gap-3 px-4 py-4 transition-colors hover:bg-orange-50/70 ${
                        notification.isRead ? 'bg-white' : 'bg-orange-50/60'
                      }`}
                    >
                      <div
                        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                          notification.isRead ? 'bg-gray-300' : 'bg-[#F59B0F]'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-semibold text-gray-900">{notification.title}</p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {notification.navigateTo && (
                              <ArrowTopRightOnSquareIcon
                                className="h-3.5 w-3.5 text-[#AC6C2A]"
                                aria-label="Opens a page"
                              />
                            )}
                            {renderReadBadge(notification)}
                          </div>
                        </div>
                        <p className="mt-1 text-sm leading-5 text-gray-600">{notification.message}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!notificationsLoading && !notificationsError && notifications.length > 0 && (
              <div className="border-t border-gray-100 bg-gray-50 px-4 py-2.5">
                <button
                  type="button"
                  onClick={openExpandedModal}
                  className="w-full rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#AC6C2A] transition-colors hover:bg-orange-50"
                >
                  View all notifications
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {selectedNotification && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="bg-linear-to-r from-[#F59B0F] to-[#AC6C2A] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-100">Notification</p>
                  <h3 className="mt-1 text-lg font-bold text-white">{selectedNotification.title}</h3>
                </div>
                <button
                  type="button"
                  onClick={onCloseSelectedNotification}
                  className="rounded-lg bg-white/15 p-1.5 text-white transition-colors hover:bg-white/25"
                  aria-label="Close notification"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="px-5 py-4">
              <p className="whitespace-pre-line text-sm leading-6 text-gray-700">{selectedNotification.message}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              {selectedNotification.navigateTo && (
                <button
                  type="button"
                  onClick={() => {
                    activateNotification(selectedNotification, 'expanded');
                    onCloseSelectedNotification();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-linear-to-r from-[#FF6347] to-[#F59B0F] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                >
                  <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                  Open page
                </button>
              )}
              <button
                type="button"
                onClick={onCloseSelectedNotification}
                className="rounded-lg bg-orange-50 px-4 py-2 text-sm font-semibold text-[#AC6C2A] transition-colors hover:bg-orange-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <Transition appear show={isExpandedOpen} as={Fragment}>
        <Dialog as="div" className="relative z-80" onClose={closeExpandedModal}>
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
                <DialogPanel className="w-full max-w-4xl transform overflow-hidden rounded-3xl bg-white text-left shadow-2xl transition-all">
                  <div className="flex items-start justify-between gap-4 bg-linear-to-r from-[#F59B0F] via-[#FF6347] to-[#AC6C2A] px-6 py-5 text-white">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-50">Notifications</p>
                      <DialogTitle as="h2" className="mt-1 text-2xl font-black text-white">
                        All your updates
                      </DialogTitle>
                      <p className="mt-1 text-sm text-orange-50">
                        {notifications.length === 0
                          ? 'Nothing has been sent to you yet.'
                          : `${notifications.length} notification${notifications.length === 1 ? '' : 's'} · ${notificationCount} unread`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeExpandedModal}
                      className="rounded-xl bg-white/15 p-2 text-white transition-colors hover:bg-white/25"
                      aria-label="Close notifications"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="max-h-[70vh] overflow-y-auto bg-gray-50">
                    {notificationsLoading ? (
                      <div className="flex items-center justify-center gap-3 px-6 py-16 text-sm font-medium text-gray-500">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#F59B0F] border-t-transparent"></span>
                        Loading notifications...
                      </div>
                    ) : notificationsError ? (
                      <div className="px-6 py-12 text-center">
                        <p className="text-sm font-medium text-gray-700">{notificationsError}</p>
                        <button
                          type="button"
                          onClick={onRetry}
                          className="mt-4 inline-flex items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#AC6C2A] shadow-sm transition-colors hover:bg-orange-50"
                        >
                          Retry
                        </button>
                      </div>
                    ) : notifications.length === 0 ? (
                      <div className="px-6 py-16 text-center">
                        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#F59B0F] shadow-sm">
                          <BellIcon className="h-7 w-7" />
                        </div>
                        <p className="text-base font-semibold text-gray-700">No notifications yet</p>
                        <p className="mt-1 text-sm text-gray-500">New updates will appear here.</p>
                      </div>
                    ) : (
                      <ul className="divide-y divide-gray-100 bg-white">
                        {notifications.map((notification) => (
                          <li key={notification.id}>
                            <button
                              type="button"
                              onClick={() => activateNotification(notification, 'expanded')}
                              className={`w-full px-6 py-5 text-left transition-colors hover:bg-orange-50/60 ${
                                notification.isRead ? 'bg-white' : 'bg-orange-50/50'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex min-w-0 items-start gap-3">
                                  <span
                                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                                      notification.isRead ? 'bg-gray-300' : 'bg-[#F59B0F]'
                                    }`}
                                  />
                                  <div className="min-w-0">
                                    <p className="text-base font-bold text-gray-900">{notification.title}</p>
                                    <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-gray-600">
                                      {notification.message}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-2">
                                  {renderReadBadge(notification)}
                                  {notification.navigateTo && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#AC6C2A] ring-1 ring-orange-100">
                                      <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                                      Opens page
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 border-t border-gray-100 bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-gray-500">
                      Notifications with the page icon take you straight to the related screen.
                    </p>
                    <button
                      type="button"
                      onClick={closeExpandedModal}
                      className="inline-flex items-center justify-center rounded-xl bg-orange-50 px-5 py-2 text-sm font-bold text-[#AC6C2A] transition-colors hover:bg-orange-100"
                    >
                      Close
                    </button>
                  </div>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}

export default NotificationsPanel;
