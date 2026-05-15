const express = require("express");
const router = express.Router();

const userController = require("../controllers/user.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const roleMiddleware = require("../middlewares/role.middleware");

router.get("/", authMiddleware, roleMiddleware("admin"), userController.getUsers);

router.delete("/me", authMiddleware, userController.deleteMyAccount);

router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("admin"),
  userController.deleteUser
);

router.put(
  "/:id/restore",
  authMiddleware,
  roleMiddleware("admin"),
  userController.restoreUser
);

module.exports = router;
