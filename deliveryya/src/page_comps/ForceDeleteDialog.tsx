import React, { useState } from 'react';
import { MenuItem } from '@headlessui/react';
import { TrashIcon } from '@heroicons/react/24/outline';
import { runForceDelete } from '../util/DeleteFlows';
import type { ForceDeleteEntity } from '../util/ForceDeleteUtil';

type ForceDeleteEntityType =
  | 'Product'
  | 'Category'
  | 'Brand'
  | 'User'
  | 'Market'
  | 'Stock'
  | 'Order'
  | 'UrgentJob'
  | 'Branch';

interface ForceDeleteDialogProps {
  entityType: ForceDeleteEntityType;
  entityId: number;
  entityIdentifier: string;
  onSuccess: () => void;
  /**
   * `button` (default): red trash icon button.
   * `menuItem`: a "Delete permanently" row for a Headless UI `<MenuItems>`
   * overflow menu. Use it when an actions row would exceed 4 buttons
   * (the 4th button opens the menu with the extra actions).
   */
  variant?: 'button' | 'menuItem';
}

const ENTITY_KEYS: Record<ForceDeleteEntityType, ForceDeleteEntity> = {
  Product: 'product',
  Category: 'category',
  Brand: 'brand',
  User: 'user',
  Market: 'market',
  Stock: 'stock',
  Order: 'order',
  UrgentJob: 'urgentJob',
  Branch: 'branch',
};

const ENTITY_MESSAGES: Partial<Record<ForceDeleteEntityType, string>> = {
  Product: 'This permanently deletes the product and unreferenced related rows.',
  Category: 'This permanently deletes the category. It is blocked while products use it.',
  Brand: 'This permanently deletes the brand. It is blocked while products use it.',
};

/**
 * Runs the force-delete flow: preview related records, type "Delete" in the
 * universal modal, then permanently delete. Rendered as a trash button or,
 * with `variant="menuItem"`, as a row inside an overflow menu.
 */
const ForceDeleteDialog: React.FC<ForceDeleteDialogProps> = ({
  entityType,
  entityId,
  entityIdentifier,
  onSuccess,
  variant = 'button',
}) => {
  const [isBusy, setIsBusy] = useState(false);
  const label = entityType === 'UrgentJob' ? 'urgent job' : entityType.toLowerCase();

  const handleForceDelete = async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await runForceDelete({
        entity: ENTITY_KEYS[entityType],
        entityId,
        fallbackItemName: entityIdentifier,
        message: ENTITY_MESSAGES[entityType],
        onDeleted: onSuccess,
        onFailed: onSuccess,
      });
    } finally {
      setIsBusy(false);
    }
  };

  if (variant === 'menuItem') {
    return (
      <MenuItem>
        <button
          type="button"
          onClick={() => void handleForceDelete()}
          disabled={isBusy}
          className="w-full text-left flex items-center gap-3 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 data-focus:bg-red-50 rounded-lg transition disabled:cursor-wait disabled:opacity-60"
          title={`Preview related records, then permanently delete this ${label}`}
        >
          <TrashIcon className="w-4 h-4" />
          Delete permanently
        </button>
      </MenuItem>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void handleForceDelete()}
      disabled={isBusy}
      className="flex items-center justify-center p-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors shadow-sm hover:shadow-md disabled:cursor-wait disabled:opacity-60"
      title={`Force delete ${label}`}
      aria-label={`Force delete ${label}`}
    >
      <TrashIcon className="w-5 h-5" />
    </button>
  );
};

export default ForceDeleteDialog;
