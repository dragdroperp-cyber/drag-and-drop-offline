Enhance Reports Page

# Changes
1.  **Reports.js**:
    - Added `topSellingProducts` calculation using `useMemo`.
    - Added `categorySales` calculation using `useMemo`.
    - Added `dailyTransactions` calculation for the drill-down modal.
    - Added "Detailed Insights" section to the main view containing:
        - **Top Selling Products** table (showing Rank, Name, Qty, Revenue).
        - **Category Performance** list (showing Category, Revenue, % of total).
    - Added "Recent Transactions" table to the **Sales Breakdown** modal (drill-down view for a selected date).
2.  **translations.js**:
    - Added new translation keys: `topSellingProducts`, `categoryPerformance`, `soldQuantity`, `revenue`, `noTransactions`, `recentTransactions`, `time`.

# Verification
- The Reports page now displays detailed product and category insights.
- Clicking on the Sales Bar Chart opens the breakdown modal which now includes a list of transactions for that day.
