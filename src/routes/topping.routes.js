const express = require("express");
const router = express.Router();

const toppingController = require("../controllers/topping.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const roleMiddleware = require("../middlewares/role.middleware");

router.get(
  "/",
  authMiddleware,
  roleMiddleware("admin", "manager", "staff"),
  toppingController.getToppings
);
router.get(
  "/:id",
  authMiddleware,
  roleMiddleware("admin", "manager", "staff"),
  toppingController.getToppingById
);
router.post(
  "/",
  authMiddleware,
  roleMiddleware("admin", "manager"),
  toppingController.createTopping
);
router.put(
  "/:id",
  authMiddleware,
  roleMiddleware("admin", "manager"),
  toppingController.updateTopping
);
router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("admin"),
  toppingController.deleteTopping
);

module.exports = router;
