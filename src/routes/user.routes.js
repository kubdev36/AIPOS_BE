const express = require("express");
const router = express.Router();

const userController = require("../controllers/user.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.get("/", authMiddleware, userController.getUsers);

router.delete("/me", authMiddleware, userController.deleteMyAccount);

router.delete("/:id", authMiddleware, userController.deleteUser);

router.put("/:id/restore", authMiddleware, userController.restoreUser);

module.exports = router;