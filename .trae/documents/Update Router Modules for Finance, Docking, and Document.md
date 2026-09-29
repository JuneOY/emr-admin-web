I have successfully updated the router modules to match your new requirements.

1.  **Removed** old modules: `self-operated.ts` and `fulfillment.ts`.
2.  **Created** three new router modules in `src/router/modules/`:
    - **`finance.ts`** (财务对账):
      - Contains: 充值记录 (Recharge Record), 订单管理 (Order List), 流水记录 (Transaction Record).
    - **`docking.ts`** (对接管理):
      - Contains: 商品列表 (Product List), H5对接管理 (H5 Docking), API对接管理 (API Docking).
    - **`document.ts`** (对接文档):
      - Configured as an external link (currently a placeholder, needs actual URL).
3.  **Updated** `src/router/modules/index.ts` to register these new modules.
4.  **Updated** `src/locales/langs/zh.json` with the new menu titles.

You can now proceed to create the corresponding Vue view components (e.g., in `src/views/finance/` and `src/views/docking/`) to make the routes functional.
