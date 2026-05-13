const express = require("express");
const router = express.Router();

const reportController = require("../controllers/report.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.get("/overview", authMiddleware, reportController.getOverviewReport);
router.get("/revenue-7-days", authMiddleware, reportController.getRevenueLast7Days);
router.get("/top-products", authMiddleware, reportController.getTopProducts);
router.get("/low-stock", authMiddleware, reportController.getLowStockProducts);
router.get("/revenue", authMiddleware, reportController.getRevenueByDateRange);

module.exports = router;