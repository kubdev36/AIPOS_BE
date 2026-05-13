const express = require("express");
const router = express.Router();

const customerController = require("../controllers/customer.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.get("/", authMiddleware, customerController.getCustomers);
router.get("/:id", authMiddleware, customerController.getCustomerById);
router.post("/", authMiddleware, customerController.createCustomer);
router.put("/:id", authMiddleware, customerController.updateCustomer);
router.delete("/:id", authMiddleware, customerController.deleteCustomer);

module.exports = router;