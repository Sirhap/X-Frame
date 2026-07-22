"use strict";

const defaultPremiumFeatures = require("./public/premium_features");

const ROUTE_FEATURES = Object.freeze({
  "/api/frame-audio": ["tuner.frame-audio"],
  "/api/frame-attachment-image": ["tuner.image-attachments"],
  "/api/attachment-assets": ["tuner.image-attachments"],
  "/api/replace-frame": ["cutout.output"],
  "/api/replace-animation": ["cutout.output"],
  "/api/import-animation": ["organizer.output"],
  "/api/reorganize-animation": ["organizer.output"],
});

/**
 * Maps a save request body to the shared premium-feature detector contract.
 * @param {object} payload Save request body.
 * @returns {object} Premium detector snapshot.
 */
function savePremiumSnapshot(payload = {}) {
  return {
    frameAudioBindings: payload.frame_audio_bindings ?? payload.frameAudioBindings,
    frameImageAttachments: payload.frame_image_attachments ?? payload.frameImageAttachments,
    vfxFrameOverrides: payload.attack_vfx_frame_overrides,
    framePlaybackOverrides: payload.frame_playback_overrides,
    vfxPlaybackOverrides: payload.attack_vfx_playback_overrides,
    frameBoxOverrides: payload.frame_box_overrides,
    bossPlaybackOverrides: payload.boss?.boss_frame_playback_overrides,
    act2PlaybackOverrides: payload.act2StatueBoss?.frame_playback_overrides,
    huangPlaybackOverrides: payload.huangXian?.frame_playback_overrides,
    soulPlaybackOverrides: payload.soul?.frame_playback_overrides,
    soulFrameBoxOverrides: payload.soul?.frame_box_overrides,
  };
}

/**
 * Derives required premium capabilities exclusively from the trusted route contract and request body.
 * @param {string} pathname Request pathname.
 * @param {object} payload Parsed JSON request body.
 * @param {object} [premiumFeatures] Shared feature detector.
 * @returns {string[]} Required feature identifiers.
 */
function requiredPremiumFeatures(pathname, payload = {}, premiumFeatures = defaultPremiumFeatures) {
  if (pathname === "/api/save") {
    return premiumFeatures.detectTunerFeatures(savePremiumSnapshot(payload));
  }
  return Array.from(ROUTE_FEATURES[pathname] || []);
}

/**
 * Creates the local server premium authorization boundary.
 * @param {{activationService:object,HttpError:typeof Error,premiumFeatures?:object}} dependencies Authorization collaborators.
 * @returns {{assertAuthorized:(request:object,pathname:string,payload:object)=>string[]}} Premium authorizer.
 */
function createPremiumAuthorizer(dependencies = {}) {
  const { activationService, HttpError, premiumFeatures = defaultPremiumFeatures } = dependencies;
  if (typeof activationService?.isActivated !== "function" || typeof HttpError !== "function") {
    throw new TypeError("Premium authorization dependencies are required.");
  }

  return Object.freeze({
    assertAuthorized(request, pathname, payload = {}) {
      const required = requiredPremiumFeatures(pathname, payload, premiumFeatures);
      if (required.length && !activationService.isActivated(request)) {
        throw new HttpError(402, "Premium output requires activation.");
      }
      return required;
    },
  });
}

module.exports = {
  createPremiumAuthorizer,
  requiredPremiumFeatures,
  savePremiumSnapshot,
};
