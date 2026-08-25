export const DEFAULT_PRODUCT_CATEGORY = 'suits';

// Public catalogue taxonomy. New categories can be added here without changing
// the product storage shape or the storefront filtering contract.
export const PRODUCT_TAXONOMY = [
  {
    id: 'suits',
    label: 'Suits',
    subcategories: ['Women’s Suits', 'Unstitched Suit', 'Stitched Suit', 'Dress Material'],
    requiresFabric: true,
  },
  {
    id: 'bed-khat-sheets',
    label: 'Bed & Khat Sheets',
    subcategories: ['Bed Sheet', 'Khat Sheet'],
    requiresFabric: false,
  },
  {
    id: 'blankets',
    label: 'Blankets',
    subcategories: ['Blanket'],
    requiresFabric: false,
  },
  {
    id: 'pillows',
    label: 'Pillows',
    subcategories: ['Pillow', 'Pillow Cover'],
    requiresFabric: false,
  },
  {
    id: 'dupatta',
    label: 'Dupatta',
    subcategories: ['Dupatta', 'Chundri', 'Shawl', 'Stole'],
    requiresFabric: false,
  },
  {
    id: 'suit-inners',
    label: 'Suit Inners',
    subcategories: ['Suit Inner', 'Suit Lining'],
    requiresFabric: false,
  },
  {
    id: 'kurta-pajama-men',
    label: 'Kurta Pajama (Men)',
    subcategories: ['Kurta Pajama'],
    requiresFabric: false,
  },
  {
    id: 'parna',
    label: 'Parna',
    subcategories: ['Parna'],
    requiresFabric: false,
  },
  {
    id: 'mens-unstitched',
    label: 'Men’s Unstitched',
    subcategories: ['Pant Shirt Fabric', 'Shirt Fabric', 'Pant Fabric'],
    requiresFabric: false,
  },
];

export const getProductCategory = categoryId => (
  PRODUCT_TAXONOMY.find(category => category.id === categoryId)
);
