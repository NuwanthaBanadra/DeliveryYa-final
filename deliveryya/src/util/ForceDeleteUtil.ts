import axiosInstance from './AxiosUtil';

/**
 * Force-delete API helpers — preview what will be removed, then delete.
 *
 * Every entity below has a preview / force-delete endpoint pair that follows
 * the same contract (see DELETE_CONFIRM_MODAL.md):
 *   GET    /{module}/preview-force-delete-{entity}?{idParam}={id}  → ApiResponse<ForceDeletePreview>
 *   DELETE /{module}/force-delete-{entity}   body: ForceDeleteConfirm → ApiResponse<void>
 *
 * Prefer `runForceDelete` in `DeleteFlows.ts` from pages — it wires these
 * calls to the typed-confirmation modal, success/error feedback and refresh.
 */

export interface ForceDeletePreview {
  entityName: string;
  entityId: number;
  entityIdentifier: string;
  canDelete: boolean;
  blockingReason: string | null;
  relatedRecordCounts: Record<string, number>;
  recordsToBeDeleted: string[];
  recordsToBeDetached: string[];
}

export interface ForceDeleteConfirm {
  entityId: number;
  confirmed: boolean;
}

/** Backend `ResponseDto<T>` envelope. Preview DTOs live in `object`. */
export interface ApiResponse<T> {
  status: number | null;
  message: string;
  desc: string;
  object?: T;
  exData?: unknown;
}

/** Entities that have a preview + force-delete endpoint pair. */
export type ForceDeleteEntity =
  | 'user'
  | 'market'
  | 'product'
  | 'category'
  | 'brand'
  | 'stock'
  | 'order'
  | 'urgentJob'
  | 'branch';

export interface ForceDeleteRoute {
  /** Human label used in modal / toast copy, e.g. "Urgent job". */
  label: string;
  /** Preview endpoint (GET), relative to `/api/v1`. */
  previewPath: string;
  /** Query parameter carrying the id on the preview endpoint. */
  idParam: string;
  /** Force-delete endpoint (DELETE with a JSON body), relative to `/api/v1`. */
  deletePath: string;
}

export const FORCE_DELETE_ROUTES: Record<ForceDeleteEntity, ForceDeleteRoute> = {
  user: {
    label: 'User',
    previewPath: '/users/preview-force-delete-user',
    idParam: 'userId',
    deletePath: '/users/force-delete-user',
  },
  market: {
    label: 'Market',
    previewPath: '/markets/preview-force-delete-market',
    idParam: 'marketId',
    deletePath: '/markets/force-delete-market',
  },
  product: {
    label: 'Product',
    previewPath: '/products/preview-force-delete-product',
    idParam: 'productId',
    deletePath: '/products/force-delete-product',
  },
  category: {
    label: 'Category',
    previewPath: '/products/preview-force-delete-category',
    idParam: 'categoryId',
    deletePath: '/products/force-delete-category',
  },
  brand: {
    label: 'Brand',
    previewPath: '/products/preview-force-delete-brand',
    idParam: 'brandId',
    deletePath: '/products/force-delete-brand',
  },
  stock: {
    label: 'Stock',
    previewPath: '/stocks/preview-force-delete-stock',
    idParam: 'stockId',
    deletePath: '/stocks/force-delete-stock',
  },
  order: {
    label: 'Order',
    previewPath: '/orders/preview-force-delete-order',
    idParam: 'orderId',
    deletePath: '/orders/force-delete-order',
  },
  urgentJob: {
    label: 'Urgent job',
    previewPath: '/urgent-jobs/preview-force-delete-urgent-job',
    idParam: 'urgentJobId',
    deletePath: '/urgent-jobs/force-delete-urgent-job',
  },
  branch: {
    label: 'Branch',
    previewPath: '/branches/preview-force-delete-branch',
    idParam: 'branchId',
    deletePath: '/branches/force-delete-branch',
  },
};

/** Fetch the force-delete preview. Nothing is deleted. */
export const previewForceDelete = async (
  entity: ForceDeleteEntity,
  entityId: number,
): Promise<ApiResponse<ForceDeletePreview>> => {
  const route = FORCE_DELETE_ROUTES[entity];
  const response = await axiosInstance.get<ApiResponse<ForceDeletePreview>>(route.previewPath, {
    params: { [route.idParam]: entityId },
  });
  return response.data;
};

/** Permanently delete. The DTO is sent as the DELETE request body (axios `data`). */
export const forceDelete = async (
  entity: ForceDeleteEntity,
  dto: ForceDeleteConfirm,
): Promise<ApiResponse<void>> => {
  const route = FORCE_DELETE_ROUTES[entity];
  const response = await axiosInstance.delete<ApiResponse<void>>(route.deletePath, {
    data: dto,
  });
  return response.data;
};

// ------------------------------------------------------------ named helpers

// Product Force Delete
export const previewForceDeleteProduct = (productId: number) => previewForceDelete('product', productId);
export const forceDeleteProduct = (dto: ForceDeleteConfirm) => forceDelete('product', dto);

// Category Force Delete
export const previewForceDeleteCategory = (categoryId: number) => previewForceDelete('category', categoryId);
export const forceDeleteCategory = (dto: ForceDeleteConfirm) => forceDelete('category', dto);

// Brand Force Delete
export const previewForceDeleteBrand = (brandId: number) => previewForceDelete('brand', brandId);
export const forceDeleteBrand = (dto: ForceDeleteConfirm) => forceDelete('brand', dto);

// User Force Delete
export const previewForceDeleteUser = (userId: number) => previewForceDelete('user', userId);
export const forceDeleteUser = (dto: ForceDeleteConfirm) => forceDelete('user', dto);

// Market Force Delete
export const previewForceDeleteMarket = (marketId: number) => previewForceDelete('market', marketId);
export const forceDeleteMarket = (dto: ForceDeleteConfirm) => forceDelete('market', dto);

// Stock Force Delete
export const previewForceDeleteStock = (stockId: number) => previewForceDelete('stock', stockId);
export const forceDeleteStock = (dto: ForceDeleteConfirm) => forceDelete('stock', dto);

// Order Force Delete
export const previewForceDeleteOrder = (orderId: number) => previewForceDelete('order', orderId);
export const forceDeleteOrder = (dto: ForceDeleteConfirm) => forceDelete('order', dto);

// Urgent Job Force Delete
export const previewForceDeleteUrgentJob = (urgentJobId: number) => previewForceDelete('urgentJob', urgentJobId);
export const forceDeleteUrgentJob = (dto: ForceDeleteConfirm) => forceDelete('urgentJob', dto);

// Branch Force Delete
export const previewForceDeleteBranch = (branchId: number) => previewForceDelete('branch', branchId);
export const forceDeleteBranch = (dto: ForceDeleteConfirm) => forceDelete('branch', dto);
