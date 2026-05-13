const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const {
  getDescriptorFromPython,
  compareFaceWithCandidatesFromPython,
  verifyChallengeSessionFromPython,
} = require("../services/facePython.service");

const FACE_SESSION_TTL_MS = Number(process.env.FACE_SESSION_TTL_MS || 5 * 60 * 1000);
const FACE_SESSION_CHALLENGES = ["straight"];
const faceSessions = new Map();

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      branch_id: user.branch_id,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    }
  );
};

const getUploadedFaceFile = (req, fieldName) => {
  const files = req.files?.[fieldName];
  return Array.isArray(files) ? files[0] : null;
};

const getFaceRegistrationInput = (req) => {
  const straightFile =
    getUploadedFaceFile(req, "straight_file") ||
    getUploadedFaceFile(req, "straight_face") ||
    req.file ||
    getUploadedFaceFile(req, "face");

  if (straightFile) {
    return {
      file: straightFile,
    };
  }

  return null;
};

const extractDescriptorsForRegistration = async (req) => {
  const input = getFaceRegistrationInput(req);

  if (!input) {
    const error = new Error(
      "Face image is required. Upload `face`, `straight_file`, or `straight_face`."
    );
    error.statusCode = 400;
    throw error;
  }

  const descriptor = await getDescriptorFromPython(
    input.file.buffer,
    input.file.originalname
  );

  return [descriptor];
};

const sanitizeUser = (user) => {
  if (!user) return user;

  const { password, ...safeUser } = user;
  return safeUser;
};

const getErrorStatus = (error) => {
  return error?.statusCode || error?.response?.status || 500;
};

const getErrorMessage = (error, fallbackMessage) => {
  return (
    error?.response?.data?.detail ||
    error?.response?.data?.message ||
    error?.message ||
    fallbackMessage
  );
};

const createFaceChallengeSequence = () => [...FACE_SESSION_CHALLENGES];

const createFaceSession = (type) => {
  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    type,
    challenges: createFaceChallengeSequence(type),
    createdAt: Date.now(),
    expiresAt: Date.now() + FACE_SESSION_TTL_MS,
    verified: false,
    verification: null,
  };

  faceSessions.set(sessionId, session);

  return session;
};

const getFaceSession = (sessionId, expectedType) => {
  const session = faceSessions.get(sessionId);

  if (!session) {
    const error = new Error("Face session not found");
    error.statusCode = 404;
    throw error;
  }

  if (session.expiresAt < Date.now()) {
    faceSessions.delete(sessionId);

    const error = new Error("Face session expired");
    error.statusCode = 410;
    throw error;
  }

  if (expectedType && session.type !== expectedType) {
    const error = new Error("Face session type mismatch");
    error.statusCode = 400;
    throw error;
  }

  return session;
};

const requireVerifiedFaceSession = (sessionId, expectedType) => {
  const session = getFaceSession(sessionId, expectedType);

  if (!session.verified || !session.verification?.average_descriptor) {
    const error = new Error("Face session has not been verified");
    error.statusCode = 400;
    throw error;
  }

  return session;
};

const parseChallengeTypes = (value) => {
  try {
    const parsed = JSON.parse(String(value || "[]"));

    if (!Array.isArray(parsed)) {
      throw new Error("Challenge types must be an array");
    }

    return parsed;
  } catch (error) {
    const nextError = new Error("Invalid challenge types payload");
    nextError.statusCode = 400;
    throw nextError;
  }
};

const getUploadedChallengeFiles = (req, challengeTypes) => {
  if (Array.isArray(req.files)) {
    return req.files;
  }

  const fieldAliases = {
    straight: ["straight", "straight_file", "straight_face", "face"],
  };

  const frameFiles = Array.isArray(req.files?.frames) ? req.files.frames : [];
  if (frameFiles.length > 0) {
    return frameFiles;
  }

  return challengeTypes
    .map((challengeType) => {
      const aliases = fieldAliases[challengeType] || [challengeType];

      for (const fieldName of aliases) {
        const file = getUploadedFaceFile(req, fieldName);
        if (file) {
          return file;
        }
      }

      return null;
    })
    .filter(Boolean);
};

const getUploadedChallengeDebug = (req, challengeTypes) => {
  const fileGroups = Array.isArray(req.files)
    ? { frames: req.files }
    : req.files || {};

  const filesByField = Object.fromEntries(
    Object.entries(fileGroups).map(([fieldName, files]) => [
      fieldName,
      Array.isArray(files) ? files.length : 0,
    ])
  );

  return {
    challenge_types: challengeTypes,
    files_by_field: filesByField,
    total_files_received: Object.values(filesByField).reduce(
      (sum, count) => sum + count,
      0
    ),
  };
};

const completeFaceLoginWithDescriptor = async (inputDescriptor) => {
  const faceProfiles = await prisma.face_profiles.findMany({
    where: {
      status: true,
      users: {
        status: true,
      },
    },
    include: {
      users: true,
    },
  });

  if (faceProfiles.length === 0) {
    const error = new Error("No registered face profile found");
    error.statusCode = 401;
    throw error;
  }

  const compareResult = await compareFaceWithCandidatesFromPython(
    inputDescriptor,
    faceProfiles.map((profile) => ({
      id: profile.id,
      user_id: profile.user_id,
      descriptor: profile.descriptor,
    }))
  );

  const threshold = Number(process.env.FACE_MATCH_THRESHOLD || 0.6);
  const bestProfile = faceProfiles.find(
    (profile) => profile.id === compareResult?.best_match?.id
  );
  const bestDistance =
    compareResult?.best_distance ?? compareResult?.best_match?.distance;

  if (!bestProfile || !compareResult?.matched || bestDistance > threshold) {
    const error = new Error("Face not recognized");
    error.statusCode = 401;
    error.distance = bestDistance;
    throw error;
  }

  return {
    user: bestProfile.users,
    distance: bestDistance,
  };
};

const ensureNoDuplicateFace = async (descriptor) => {
  const faceProfiles = await prisma.face_profiles.findMany({
    where: {
      status: true,
      users: {
        status: true,
      },
    },
    include: {
      users: true,
    },
  });

  if (faceProfiles.length === 0) {
    return null;
  }

  const compareResult = await compareFaceWithCandidatesFromPython(
    descriptor,
    faceProfiles.map((profile) => ({
      id: profile.id,
      user_id: profile.user_id,
      descriptor: profile.descriptor,
    }))
  );

  const threshold = Number(process.env.FACE_MATCH_THRESHOLD || 0.6);
  const bestProfile = faceProfiles.find(
    (profile) => profile.id === compareResult?.best_match?.id
  );
  const bestDistance =
    compareResult?.best_distance ?? compareResult?.best_match?.distance;

  if (bestProfile && compareResult?.matched && bestDistance <= threshold) {
    const error = new Error("Face already registered");
    error.statusCode = 409;
    error.matchedUser = bestProfile.users;
    throw error;
  }

  return null;
};

const startFaceSession = async (req, res) => {
  try {
    const type = req.body?.type === "register" ? "register" : "login";
    const session = createFaceSession(type);

    return res.status(201).json({
      success: true,
      message: "Face session created",
      session_id: session.id,
      type: session.type,
      challenges: session.challenges,
      expires_at: session.expiresAt,
      expires_in_ms: FACE_SESSION_TTL_MS,
    });
  } catch (error) {
    return res.status(getErrorStatus(error)).json({
      success: false,
      message: getErrorMessage(error, "Cannot start face session"),
    });
  }
};

const verifyFaceSession = async (req, res) => {
  try {
    const { session_id } = req.body;
    const challengeTypes = parseChallengeTypes(req.body.challenge_types);
    const session = getFaceSession(session_id);
    const files = getUploadedChallengeFiles(req, challengeTypes);
    const debugInfo = getUploadedChallengeDebug(req, challengeTypes);

    if (files.length !== session.challenges.length) {
      return res.status(400).json({
        success: false,
        message: "Face challenge images count mismatch",
        expected_count: session.challenges.length,
        received_count: files.length,
        expected_challenges: session.challenges,
        debug: debugInfo,
      });
    }

    if (JSON.stringify(challengeTypes) !== JSON.stringify(session.challenges)) {
      return res.status(400).json({
        success: false,
        message: "Face challenge order mismatch",
        expected_challenges: session.challenges,
        received_challenges: challengeTypes,
        debug: debugInfo,
      });
    }

    const verification = await verifyChallengeSessionFromPython(
      files,
      session.challenges
    );

    session.verified = true;
    session.verification = verification;
    session.expiresAt = Date.now() + FACE_SESSION_TTL_MS;

    return res.json({
      success: true,
      message: "Face session verified",
      session_id: session.id,
      type: session.type,
      challenges: session.challenges,
      verification,
    });
  } catch (error) {
    console.error("Verify face session error:", error?.response?.data || error);

    return res.status(getErrorStatus(error)).json({
      success: false,
      message: getErrorMessage(error, "Face session verification failed"),
      debug:
        getErrorStatus(error) < 500
          ? {
              session_id: req.body?.session_id || null,
              challenge_types: req.body?.challenge_types || null,
            }
          : undefined,
    });
  }
};

const loginWithFaceSession = async (req, res) => {
  try {
    const session = requireVerifiedFaceSession(req.body?.session_id, "login");
    const { user, distance } = await completeFaceLoginWithDescriptor(
      session.verification.average_descriptor
    );

    faceSessions.delete(session.id);

    const token = generateToken(user);

    return res.json({
      success: true,
      message: "Face login successfully",
      token,
      user: sanitizeUser(user),
      distance,
    });
  } catch (error) {
    console.error("Face session login error:", error?.response?.data || error);

    return res.status(getErrorStatus(error)).json({
      success: false,
      message: getErrorMessage(error, "Face session login failed"),
      distance: error?.distance,
    });
  }
};

const registerWithFaceSession = async (req, res) => {
  try {
    const { full_name, email, phone, password, role, branch_id, session_id } =
      req.body;

    if (!full_name || !email || !password || !session_id) {
      return res.status(400).json({
        success: false,
        message: "Full name, email, password and session_id are required",
      });
    }

    const session = requireVerifiedFaceSession(session_id, "register");
    const existingUser = await prisma.users.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already exists",
      });
    }

    await ensureNoDuplicateFace(session.verification.average_descriptor);

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.users.create({
        data: {
          branch_id: branch_id ? Number(branch_id) : 1,
          full_name,
          email,
          phone: phone || null,
          password: hashedPassword,
          role: role || "staff",
        },
      });

      await tx.face_profiles.createMany({
        data: session.verification.descriptors.map((descriptor) => ({
          user_id: newUser.id,
          descriptor,
          status: true,
        })),
      });

      return newUser;
    });

    faceSessions.delete(session.id);

    const token = generateToken(user);

    return res.status(201).json({
      success: true,
      message: "Register with face session successfully",
      token,
      user: sanitizeUser(user),
      face_samples_count: session.verification.descriptors.length,
    });
  } catch (error) {
    console.error(
      "Register with face session error:",
      error?.response?.data || error
    );

    return res.status(getErrorStatus(error)).json({
      success: false,
      message: getErrorMessage(error, "Register with face session failed"),
      matched_user: error?.matchedUser ? sanitizeUser(error.matchedUser) : null,
    });
  }
};

const registerWithFace = async (req, res) => {
  try {
    const { full_name, email, phone, password, role, branch_id } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Full name, email and password are required",
      });
    }

    const existingUser = await prisma.users.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already exists",
      });
    }

    const descriptors = await extractDescriptorsForRegistration(req);

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.users.create({
        data: {
          branch_id: branch_id ? Number(branch_id) : 1,
          full_name,
          email,
          phone: phone || null,
          password: hashedPassword,
          role: role || "staff",
        },
      });

      await tx.face_profiles.createMany({
        data: descriptors.map((descriptor) => ({
          user_id: newUser.id,
          descriptor,
          status: true,
        })),
      });

      return newUser;
    });

    const token = generateToken(user);

    return res.status(201).json({
      success: true,
      message: "Register with face successfully",
      token,
      user: sanitizeUser(user),
      face_samples_count: descriptors.length,
    });
  } catch (error) {
    console.error("Register with face error:", error?.response?.data || error);

    return res.status(getErrorStatus(error)).json({
      success: false,
      message: getErrorMessage(error, "Register with face failed"),
    });
  }
};

const addFaceToCurrentUser = async (req, res) => {
  try {
    const descriptors = await extractDescriptorsForRegistration(req);

    await prisma.$transaction(async (tx) => {
      await tx.face_profiles.updateMany({
        where: {
          user_id: Number(req.user.id),
        },
        data: {
          status: false,
        },
      });

      await tx.face_profiles.createMany({
        data: descriptors.map((descriptor) => ({
          user_id: Number(req.user.id),
          descriptor,
          status: true,
        })),
      });
    });

    return res.json({
      success: true,
      message: "Face registered successfully",
      face_samples_count: descriptors.length,
    });
  } catch (error) {
    console.error("Add face error:", error?.response?.data || error);

    return res.status(getErrorStatus(error)).json({
      success: false,
      message: getErrorMessage(error, "Add face failed"),
    });
  }
};

const loginWithFace = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Face image is required",
      });
    }

    const inputDescriptor = await getDescriptorFromPython(
      req.file.buffer,
      req.file.originalname
    );

    const { user, distance } = await completeFaceLoginWithDescriptor(
      inputDescriptor
    );

    const token = generateToken(user);

    return res.json({
      success: true,
      message: "Face login successfully",
      token,
      user: sanitizeUser(user),
      distance,
    });
  } catch (error) {
    console.error("Face login error:", error?.response?.data || error);

    return res.status(getErrorStatus(error)).json({
      success: false,
      message: getErrorMessage(error, "Face login failed"),
    });
  }
};

module.exports = {
  startFaceSession,
  verifyFaceSession,
  loginWithFaceSession,
  registerWithFaceSession,
  registerWithFace,
  addFaceToCurrentUser,
  loginWithFace,
};
