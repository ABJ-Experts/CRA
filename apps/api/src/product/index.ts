// Public interface (Facade) for the product module.
export {
  createProduct,
  listProducts,
  getProduct,
  transitionLifecycle,
  archiveProduct,
  canTransition,
  DomainError,
  type LifecycleState,
  type ProductType,
  type CreateProductInput,
  type ProductView,
  type ProductFilter,
} from './product.service';
export { ProductModule } from './product.module';
