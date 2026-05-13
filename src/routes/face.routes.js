const express = require("express");
const router = express.Router();

const faceController = require("../controllers/face.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");

router.post("/session/start", faceController.startFaceSession);

router.post(
  "/session/verify",
  upload.fields([
    { name: "frames", maxCount: 1 },
    { name: "straight", maxCount: 1 },
    { name: "straight_file", maxCount: 1 },
    { name: "straight_face", maxCount: 1 },
    { name: "face", maxCount: 1 },
  ]),
  faceController.verifyFaceSession
);

router.post("/login-session", faceController.loginWithFaceSession);

router.post("/register-session", faceController.registerWithFaceSession);

router.post(
  "/register",
  upload.fields([
    { name: "face", maxCount: 1 },
    { name: "straight_file", maxCount: 1 },
    { name: "straight_face", maxCount: 1 },
  ]),
  faceController.registerWithFace
);

router.post(
  "/login",
  upload.single("face"),
  faceController.loginWithFace
);

router.post(
  "/add-face",
  authMiddleware,
  upload.fields([
    { name: "face", maxCount: 1 },
    { name: "straight_file", maxCount: 1 },
    { name: "straight_face", maxCount: 1 },
  ]),
  faceController.addFaceToCurrentUser
);

module.exports = router;
