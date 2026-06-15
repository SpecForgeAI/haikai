/**
 * MissionTab Component
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
 *
 * Renders the product mission editor body for the `/.../product/mission`
 * sub-route. Currently a thin wrapper around the existing `ProductPage`
 * component (which is the product-definition editor in DB mode); the spec
 * unifies the legacy `?tab=product` and the new `mission` URL into a single
 * sub-route so the URL contract is canonical.
 *
 * Mounted as a child route of `<ProductView/>` via the routes tree in
 * `App.tsx`. Reads no URL params.
 */

import { ProductPage } from './ProductPage';

export function MissionTab() {
  return <ProductPage />;
}
