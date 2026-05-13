const axios = require("axios");
const FormData = require("form-data");

const getFaceServiceUrl = () => {
  const baseUrl = process.env.FACE_SERVICE_URL;

  if (!baseUrl) {
    const error = new Error("FACE_SERVICE_URL is not configured");
    error.statusCode = 500;
    throw error;
  }

  return baseUrl.replace(/\/+$/, "");
};

const mapFaceServiceError = (error) => {
  if (error.response) {
    return error;
  }

  const mappedError = new Error(
    "Face service is unavailable. Please make sure face-service is running."
  );
  mappedError.statusCode = 502;
  mappedError.cause = error;

  return mappedError;
};

const getDescriptorFromPython = async (fileBuffer, filename = "face.jpg") => {
  const formData = new FormData();

  formData.append("file", fileBuffer, {
    filename,
    contentType: "image/jpeg",
  });

  try {
    const response = await axios.post(
      `${getFaceServiceUrl()}/face/descriptor`,
      formData,
      {
        headers: formData.getHeaders(),
        timeout: 30000,
      }
    );

    return response.data.descriptor;
  } catch (error) {
    throw mapFaceServiceError(error);
  }
};

const compareFaceWithPython = async (descriptor1, descriptor2) => {
  try {
    const response = await axios.post(
      `${getFaceServiceUrl()}/face/compare`,
      {
        descriptor1,
        descriptor2,
        threshold: Number(process.env.FACE_MATCH_THRESHOLD || 0.6),
      },
      {
        timeout: 30000,
      }
    );

    return response.data;
  } catch (error) {
    throw mapFaceServiceError(error);
  }
};

const compareFaceWithCandidatesFromPython = async (descriptor, candidates) => {
  try {
    const response = await axios.post(
      `${getFaceServiceUrl()}/face/compare-many`,
      {
        descriptor,
        candidates,
        threshold: Number(process.env.FACE_MATCH_THRESHOLD || 0.6),
      },
      {
        timeout: 30000,
      }
    );

    return response.data;
  } catch (error) {
    throw mapFaceServiceError(error);
  }
};

const verifyChallengeSessionFromPython = async (files, challengeTypes) => {
  const formData = new FormData();

  files.forEach((file, index) => {
    formData.append("files", file.buffer, {
      filename: file.originalname || `challenge-${index + 1}.jpg`,
      contentType: file.mimetype || "image/jpeg",
    });
  });

  formData.append("challenge_types", JSON.stringify(challengeTypes));

  try {
    const response = await axios.post(
      `${getFaceServiceUrl()}/face/challenge-verify`,
      formData,
      {
        headers: formData.getHeaders(),
        timeout: 30000,
      }
    );

    return response.data;
  } catch (error) {
    throw mapFaceServiceError(error);
  }
};

module.exports = {
  getDescriptorFromPython,
  compareFaceWithPython,
  compareFaceWithCandidatesFromPython,
  verifyChallengeSessionFromPython,
};
