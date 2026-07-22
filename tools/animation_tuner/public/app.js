const els = globalThis.XSXBAppDom.createElements();
const browserRuntime = globalThis.XSXBBrowserRuntime;
const browserOnlyMode = browserRuntime?.isEnabled() === true;
if (browserOnlyMode) {
  document.body.classList.add("browserOnlyMode");
  const browserModeBanner = document.querySelector("#browserModeBanner");
  if (browserModeBanner) browserModeBanner.hidden = false;
}

/**
 * Exports processed organizer frames without calling the local project API.
 * @param {object} metadata Animation export metadata.
 * @param {Array<object>} items Processed PNG frame records.
 * @param {{onProgress?:(current:number,total:number)=>void}} [options] Export progress callbacks.
 * @returns {Promise<object>} Browser ZIP export result.
 */
async function exportBrowserAnimation(metadata, items, options = {}) {
  if (!browserRuntime) throw new Error("Browser export runtime is unavailable.");
  const requiredFeatures = premiumFeatures.normalizeFeatureIds([
    "organizer.output",
    ...Array.from(options.premiumFeatures || []),
  ]);
  let authorization = null;
  if (browserOnlyMode) {
    const exportModule = globalThis.XSXBWorkbenchExport;
    if (typeof exportModule?.authorizeExport !== "function") {
      throw new Error("Export authorization is unavailable.");
    }
    authorization = await exportModule.authorizeExport(
      { ensureActivated: ensurePremiumActivated, fetchImpl: globalThis.fetch },
      requiredFeatures,
    );
    if (!authorization) return null;
  } else if (!(await ensurePremiumActivated(requiredFeatures))) {
    return null;
  }
  return browserRuntime.exportAnimationPackage(metadata, items, {
    authorization,
    fetchImpl: globalThis.fetch,
    premiumFeatures: browserOnlyMode ? requiredFeatures : [],
    onProgress: (current) => options.onProgress?.(Math.min(current, items.length), items.length),
  });
}

/**
 * Creates a transient animation group so browser users can continue into the tuning workbench.
 * The frame data remains in memory and is intentionally not presented as a Godot project write.
 * @param {object} metadata Animation metadata collected by the organizer.
 * @param {Array<object>} items Processed PNG frame records.
 * @returns {Promise<object>} Created browser-session animation group.
 */
async function createBrowserSessionAnimation(metadata, items, options = {}) {
  if (!browserOnlyMode || !config || !Array.isArray(config.groups)) {
    throw new Error(
      language === "zh" ? "浏览器动画会话尚未就绪。" : "The browser animation session is not ready.",
    );
  }
  const group = browserRuntime.createSessionAnimationGroup(
    { ...metadata, premiumFeatures: options.premiumFeatures || [] },
    items,
    config.groups,
    language,
  );
  const profileId = group.profileId;
  if (!Array.isArray(config.profiles)) config.profiles = [];
  const profileAdded = !config.profiles.some((profile) => profile.id === profileId);
  config.groups.push(group);
  if (profileAdded) {
    config.profiles.push({ id: profileId, label: group.profileLabel, kind: group.profileKind });
  }
  try {
    renderProfileSelect();
    renderGroupSelect();
    renderChainGroupSelect();
    await selectGroup(group, { fitView: true });
    resizeCanvas();
    return group;
  } catch (error) {
    config.groups.splice(config.groups.indexOf(group), 1);
    if (profileAdded && !config.groups.some((entry) => entry.profileId === profileId)) {
      config.profiles = config.profiles.filter((profile) => profile.id !== profileId);
    }
    renderProfileSelect();
    renderGroupSelect();
    renderChainGroupSelect();
    throw error;
  }
}

const ctx = els.stage.getContext("2d");
const { constants: appConstants } = globalThis.XSXBAppState;
const {
  FRAME_DURATION_STEP_MS,
  MIN_FRAME_DURATION_MS,
  PRELOAD_FRAME_LIMIT,
  PRELOAD_CONCURRENCY,
  BOX_PREF_KEYS,
  ADJUSTMENT_MODE_KEY,
  ADJUSTMENT_MODES,
  BOX_NAMES,
  BOX_DRAW_ORDER,
  COLLISION_BOX_HANDLES,
  FRAME_AUDIO_DB_NAME,
  FRAME_AUDIO_DB_VERSION,
  FRAME_AUDIO_STORE,
  LAYER_CARD_DRAG_TYPE,
  ATTACHMENT_ASSET_DRAG_TYPE,
  GROUP_PLAYBACK_FRAME,
} = appConstants;
const {
  assetUrl,
  clampInteger,
  clampNumber,
  cloneScaleVector,
  cloneVector,
  escapeHtml,
  groupBindingLabel,
  groupLabel,
  isNumberInputTarget,
  isTypingTarget,
  mapWithConcurrency,
  nearlyEqual,
  projectLabel,
  round,
  scaleVectorFromTransform,
} = globalThis.XSXBAppUtils;
const {
  collisionOffsetYForHeight,
  isCollisionBox,
  normalizeFrameBox,
  pointInBoxRect,
  pointInRect,
  rotatePoint,
  rotateVector,
  transformBoxByDelta,
  transformHasDelta,
  transformScaleX,
  transformScaleY,
} = globalThis.XSXBBoxGeometry;
const {
  attachmentLayerOrder,
  frameImageAttachmentClipboardItem,
  newLocalId,
  normalizeAttachmentLayerOrder,
  normalizeAttachmentTransform,
  normalizeFrameImageAttachment,
} = globalThis.XSXBAttachmentUtils;
const I18N = globalThis.XSXBAppI18n.messages;
let {
  config,
  language,
  uiTheme,
  canvasColor,
  selectedProjectId,
  selectedSceneId,
  currentGroup,
  selectedFrame,
  selectedFrames,
  selectionAnchorFrame,
  selectedProfileId,
  groupSearch,
  images,
  chainImages,
  frameOverrides,
  vfxFrameOverrides,
  framePlaybackOverrides,
  vfxPlaybackOverrides,
  bossFrameOverrides,
  bossPlaybackOverrides,
  act2StatueBossFrameOverrides,
  act2StatueBossPlaybackOverrides,
  huangXianFrameOverrides,
  huangXianPlaybackOverrides,
  soulFrameOverrides,
  soulPlaybackOverrides,
  soulFrameBoxOverrides,
  yechengPropFrameOverrides,
  values,
  bossValues,
  act2StatueBossValues,
  huangXianValues,
  soulValues,
  yechengPropValues,
  sceneSettings,
  previewOwnerGroup,
  previewOwnerImages,
  coordinateOwnerGroup,
  coordinateOwnerImages,
  attachedLayerImageSets,
  frameImageAttachments,
  attachmentAssets,
  frameMutationPending,
  selectedAttachmentId,
  frameImageAttachmentClipboard,
  frameImageAttachmentClipboardProjectId,
  ghost,
  referenceFrameHiddenByKey,
  playing,
  lastPlay,
  playbackAnimationFrame,
  pointerStagePoint,
  playbackPrimaryGroup,
  playbackSecondaryGroup,
  playbackSwitching,
  view,
  stageViewMode,
  drag,
  undoStack,
  redoStack,
  inputEditSnapshots,
  baseEditSnapshot,
  boxEditSnapshot,
  attachmentWheelUndoTimer,
  attachmentWheelUndoLabel,
  heldAttachmentTransformKeys,
  imageCache,
  opaqueRectCache,
  huangXianAnchorXCache,
  referenceFrame,
  frameAudioBindings,
  imageElements,
  layerCardDrag,
  showBoxes,
  boxOnlyMode,
  selectedBox,
  selectedBoxes,
  adjustmentMode,
  frameBoxOverrides,
  dirty,
  editRevision,
  saveInFlight,
  lastSavedAt,
  batchCutout,
  frameOrganizer,
  cutoutReturnTool,
  homeHubDismissed,
} = globalThis.XSXBAppState.createInitialState();

const appConfirmModule = globalThis.XSXBAppConfirm;
if (!appConfirmModule) throw new Error("XSXBAppConfirm is required.");
const appConfirmation = appConfirmModule.createController({
  elements: {
    panel: els.appConfirmPanel,
    card: els.appConfirmCard,
    title: els.appConfirmTitle,
    message: els.appConfirmMessage,
    details: els.appConfirmDetails,
    cancel: els.appConfirmCancel,
    accept: els.appConfirmAccept,
  },
  documentRef: globalThis.document,
  windowRef: globalThis,
});
const premiumFeatures = globalThis.XSXBPremiumFeatures;
if (!premiumFeatures) throw new Error("XSXBPremiumFeatures is required.");
const activationModule = globalThis.XSXBActivation;
if (!activationModule) throw new Error("XSXBActivation is required.");
const deviceIdentityModule = globalThis.XSXBDeviceIdentity;
if (browserOnlyMode && !deviceIdentityModule) throw new Error("XSXBDeviceIdentity is required.");
const deviceIdentity = browserOnlyMode
  ? deviceIdentityModule?.createController({
      fetchImpl: globalThis.fetch,
      cryptoApi: globalThis.crypto,
      navigatorRef: globalThis.navigator,
    })
  : null;
const activationController = activationModule.createController({
  documentRef: globalThis.document,
  windowRef: globalThis,
  fetchImpl: globalThis.fetch,
  getLanguage: () => language,
  premiumFeatures,
  deviceIdentity,
});
if (browserOnlyMode) void activationController.refreshStatus();
const ensurePremiumActivated = (featureIds) => activationController.ensureActivated(featureIds);

/**
 * Opens the localized main-workbench confirmation layer.
 * @param {string} message Confirmation message.
 * @param {{title?:string,confirmLabel?:string,cancelLabel?:string,tone?:"warning"|"danger"}} [options] Dialog presentation.
 * @returns {Promise<boolean>} Whether the user accepted the action.
 */
function requestAppConfirmation(message, options = {}) {
  return appConfirmation.requestConfirmation(message, [], {
    title: options.title || t("confirmTitle"),
    confirmLabel: options.confirmLabel || t("confirm"),
    cancelLabel: options.cancelLabel || t("cancel"),
    tone: options.tone || "warning",
  });
}

let projectStateController = null;

function projectStateCall(name, ...args) {
  if (!projectStateController) throw new Error("XSXBAppProjectState is not initialized.");
  return projectStateController[name](...args);
}

let appToolActionsController = null;

function appToolActionsCall(name, ...args) {
  if (!appToolActionsController) throw new Error("XSXBAppToolActions is not initialized.");
  return appToolActionsController[name](...args);
}

function applyCutoutOutputsToCurrentAnimation(...args) {
  return appToolActionsCall("applyCutoutOutputsToCurrentAnimation", ...args);
}

function applyFrameOrganizerPlan(...args) {
  return appToolActionsCall("applyFrameOrganizerPlan", ...args);
}

function deleteSelectedAnimationFrames(...args) {
  return appToolActionsCall("deleteSelectedAnimationFrames", ...args);
}

function clearCurrentAnimation(...args) {
  return appToolActionsCall("clearCurrentAnimation", ...args);
}

function createAnimationFromOrganizer(...args) {
  return appToolActionsCall("createAnimationFromOrganizer", ...args);
}

let adjustmentInputsController = null;

function adjustmentInputsCall(name, ...args) {
  if (!adjustmentInputsController) throw new Error("XSXBAppAdjustmentInputs is not initialized.");
  return adjustmentInputsController[name](...args);
}

let attachmentManipulationController = null;

function attachmentManipulationCall(name, ...args) {
  if (!attachmentManipulationController) {
    throw new Error("XSXBAppAttachmentManipulation is not initialized.");
  }
  return attachmentManipulationController[name](...args);
}

function frameImageAttachmentScreenRect(...args) {
  return attachmentManipulationCall("frameImageAttachmentScreenRect", ...args);
}

function hitTestDirectManipulationAttachment(...args) {
  return attachmentManipulationCall("hitTestDirectManipulationAttachment", ...args);
}

function attachmentOffsetDeltaFromClientDelta(...args) {
  return attachmentManipulationCall("attachmentOffsetDeltaFromClientDelta", ...args);
}

function applySelectedAttachmentWheel(...args) {
  return attachmentManipulationCall("applySelectedAttachmentWheel", ...args);
}

let playbackInputsController = null;

function playbackInputsCall(name, ...args) {
  if (!playbackInputsController) throw new Error("XSXBAppPlaybackInputs is not initialized.");
  return playbackInputsController[name](...args);
}

function updateSelectedPlaybackFromInputs(...args) {
  return playbackInputsCall("updateSelectedPlaybackFromInputs", ...args);
}

function adjustFrameDurationMs(...args) {
  return playbackInputsCall("adjustFrameDurationMs", ...args);
}

function updateGroupPlaybackFromInputs(...args) {
  return playbackInputsCall("updateGroupPlaybackFromInputs", ...args);
}

let projectSelectsController = null;

function projectSelectsCall(name, ...args) {
  if (!projectSelectsController) throw new Error("XSXBAppProjectSelects is not initialized.");
  return projectSelectsController[name](...args);
}

function renderProjectSelect(...args) {
  return projectSelectsCall("renderProjectSelect", ...args);
}

function filteredGroups(...args) {
  return projectSelectsCall("filteredGroups", ...args);
}

function profileOptionsFromConfig(...args) {
  return projectSelectsCall("profileOptionsFromConfig", ...args);
}

function renderProfileSelect(...args) {
  return projectSelectsCall("renderProfileSelect", ...args);
}

function renderGroupSelect(...args) {
  return projectSelectsCall("renderGroupSelect", ...args);
}

function renderChainGroupSelect(...args) {
  return projectSelectsCall("renderChainGroupSelect", ...args);
}

let frameEditStateController = null;

function frameEditStateCall(name, ...args) {
  if (!frameEditStateController) throw new Error("XSXBAppFrameEditState is not initialized.");
  return frameEditStateController[name](...args);
}

let canvasRenderer = null;

function draw(...args) {
  return canvasRenderer?.draw(...args);
}

function currentFrameRect(...args) {
  return canvasRenderer?.currentFrameRect(...args) || null;
}

function frameScreenRect(...args) {
  return canvasRenderer?.frameScreenRect(...args) || null;
}

function effectiveFlipH(...args) {
  return canvasRenderer?.effectiveFlipH(...args) || false;
}

function isPointInsideFrame(...args) {
  return canvasRenderer?.isPointInsideFrame(...args) || false;
}

function playbackNeedsContinuousDraw(...args) {
  return canvasRenderer?.playbackNeedsContinuousDraw(...args) || false;
}

function updateCoordHud(...args) {
  return canvasRenderer?.updateCoordHud(...args);
}

const frameSelection = globalThis.XSXBFrameSelection.createController({
  getCurrentGroup: () => currentGroup,
  getSelectedFrame: () => selectedFrame,
  setSelectedFrame: (value) => {
    selectedFrame = value;
  },
  getSelectedFrames: () => selectedFrames,
  setSelectedFrames: (value) => {
    selectedFrames = value;
  },
  getSelectionAnchorFrame: () => selectionAnchorFrame,
  setSelectionAnchorFrame: (value) => {
    selectionAnchorFrame = value;
  },
});
const {
  clampFrameIndex,
  selectedFrameCount,
  selectedFrameIndexes,
  setFrameSelection,
  setSingleFrameSelection,
} = frameSelection;
const referenceFrameController = globalThis.XSXBReferenceFrame.createController({
  getCurrentGroup: () => currentGroup,
  getSelectedFrame: () => selectedFrame,
  getImages: () => images,
  getReferenceFrame: () => referenceFrame,
  setReferenceFrame: (value) => {
    referenceFrame = value;
  },
  frameTransform,
  renderFilmstrip,
  draw,
});
const { isReferenceFrame, referenceFrameIndex, setReferenceFrameEnabled } = referenceFrameController;
const frameAudio = globalThis.XSXBFrameAudio.createController({
  dbName: FRAME_AUDIO_DB_NAME,
  dbVersion: FRAME_AUDIO_DB_VERSION,
  storeName: FRAME_AUDIO_STORE,
  getBindings: () => frameAudioBindings,
  getActiveProjectId: activeProjectId,
  getFrameAudioKey: frameAudioKey,
  getFrameAudioMetadata: frameAudioMetadata,
  getFrameAudioMetadataFromKey: frameAudioMetadataFromKey,
  revokeBinding: revokeFrameAudioBinding,
  status,
  translate: t,
  getConfig: () => config,
  indexedDBRef: globalThis.indexedDB,
  urlApi: globalThis.URL,
  audioConstructor: globalThis.Audio,
  fileReaderConstructor: globalThis.FileReader,
  fetchImpl: globalThis.fetch,
});
const loadFrameAudioBindingsFromDb = frameAudio.loadFromDb;
const setFrameAudioBinding = frameAudio.setBinding;
const clearFrameAudioBinding = frameAudio.clearBinding;
const playFrameAudio = frameAudio.play;
const collectFrameAudioBindingsForSave = frameAudio.collectForSave;
const syncFrameAudioBindingsToGame = frameAudio.syncToGame;
const routing = globalThis.XSXBAppRouting.createController({
  elements: els,
  getConfig: () => config,
  getLanguage: () => language,
  getCurrentGroup: () => currentGroup,
  getHomeHubDismissed: () => homeHubDismissed,
  setHomeHubDismissed: (dismissed) => {
    homeHubDismissed = Boolean(dismissed);
  },
  getSelectedFrame: () => selectedFrame,
  getActiveProjectId: activeProjectId,
  getBatchCutout: () => batchCutout,
  getFrameOrganizer: () => frameOrganizer,
  translate: t,
  projectLabel,
  groupLabel,
});
const {
  applyWorkbenchRoute,
  currentWorkbenchRoute,
  renderHomeHub,
  syncUrlState,
  syncWorkbenchRoute,
  updateDocumentTitle,
} = routing;
const playbackTiming = globalThis.XSXBPlaybackTiming.createController({
  minFrameDurationMs: MIN_FRAME_DURATION_MS,
  getCurrentGroup: () => currentGroup,
  getConfig: () => config,
  getSelectedFrame: () => selectedFrame,
  getPlaybackStore: playbackStore,
  getTuningFrameKey: tuningFrameKey,
  getGroupPlaybackKey: groupPlaybackKey,
  groupOwnsFrameKey,
  getClampInteger: clampInteger,
  cloneVector,
  nearlyEqual,
  markDirty,
  getAdjustmentMode: () => adjustmentMode,
  elements: els,
  canEditFramePlayback,
  confirm: requestAppConfirmation,
  translate: t,
  pushUndo: (label) => history.pushUndo(label),
  syncFrameInputs,
  syncGroupPlaybackInputs,
  renderFilmstrip,
  updateGroupMeta,
  updateWorkbenchHud,
  draw,
});
const {
  applyGroupTimeFromInput,
  attachedPlaybackOwnerGroup,
  attachedVfxPlaybackWindow,
  clearFrameDurationOverrides,
  clearGroupTimeOverride,
  effectiveFrameDurationMultiplier,
  frameDurationMs,
  frameDurationMsLabel,
  frameDurationMultiplierFromMs,
  framePlayback,
  getGroupPlaybackOverride: groupPlaybackOverride,
  groupHasFrameDurationOverrides,
  groupHasGroupTimeOverride,
  groupPlaybackDurationSeconds,
  groupPlaybackDurationUnits,
  groupPlaybackFps,
  groupRootMotion,
  groupTimeMs,
  playableFrameCount,
  preserveGroupPlaybackDuration,
  rawGroupPlaybackFps,
  setFramePlayback,
  setGroupPlaybackData,
  setGroupTimeMs,
  syncGroupTimeInputs,
  usesAttachedPlaybackTiming,
} = playbackTiming;
const transformRuntimeModule = globalThis.XSXBTransformRuntime;
if (!transformRuntimeModule) throw new Error("XSXBTransformRuntime is required.");
const transformRuntime = transformRuntimeModule.createController({
  getConfig: () => config,
  getCurrentGroup: () => currentGroup,
  getSelectedFrame: () => selectedFrame,
  getImages: () => images,
  getValueStore: valueStore,
  getActiveSceneScale: () => activeSceneScale(),
  getOpaqueRectForImage: (...args) => opaqueRectForImage(...args),
  cloneScaleVector,
  cloneVector,
});
const {
  playerPreviewVisualHeight,
  huangXianRuntimeBaseScale,
  targetHeightScaleForGroup,
  targetHeightForGroup,
  usesTargetHeightFootAnchor,
  usesCanvasBottomCenterAnchor,
  usesCanvasLeftBottomAnchor,
  usesCanvasFootAnchor,
  usesSceneTopLeftAnchor,
  usesPropFootAnchor,
  usesGenericFootAnchor,
  usesRuntimeFootAnchor,
  targetHeightRuntimeBaseScale,
  soulAttachedVfxRuntimeBaseScale,
  characterBaseScaleForGroup,
  runtimeBaseScaleForGroup,
  characterTransform,
  renderTransformForGroup,
  targetHeightAnimationAnchorX,
  targetHeightAnimationAnchorY,
  baseTransform,
} = transformRuntime;
const boxDefaults = globalThis.XSXBBoxDefaults.createController({
  getCurrentGroup: () => currentGroup,
  getSelectedFrame: () => selectedFrame,
  getValues: () => values,
  getConfig: () => config,
  framePlayback,
  cloneVector,
  clampNumber,
  collisionOffsetYForHeight,
  normalizeFrameBox,
  usesCanvasFootAnchor,
  sourceBodyCenterForBox,
  sourceAnchorForBox,
});
const {
  boxRuleText,
  defaultCollisionBox,
  defaultHitbox,
  defaultHitboxOffset,
  defaultHurtbox,
  defaultSoulHitbox,
  firstPlayableFrameInRange,
  hasBoxRuleToken,
  hitboxActiveByDefault,
  isAttackAnimationGroup,
  isNonAttackAnimationGroup,
  lastPlayableFrameInRange,
  soulHurtboxActiveByDefault,
  soulHitboxActiveByDefault,
  soulParryGuardFrameRange,
  soulRawParryGuardFrameRange,
} = boxDefaults;
const playback = globalThis.XSXBAppPlayback.createController({
  getPlaying: () => playing,
  getPlaybackAnimationFrame: () => playbackAnimationFrame,
  setPlaybackAnimationFrame: (value) => {
    playbackAnimationFrame = value;
  },
  getCurrentGroup: () => currentGroup,
  getImages: () => images,
  getPlaybackSwitching: () => playbackSwitching,
  getLastPlay: () => lastPlay,
  setLastPlay: (value) => {
    lastPlay = value;
  },
  getSelectedFrame: () => selectedFrame,
  getPlaybackPrimaryGroup: () => playbackPrimaryGroup,
  getPlaybackSecondaryGroup: () => playbackSecondaryGroup,
  setPlaybackSwitching: (value) => {
    playbackSwitching = value;
  },
  getFramePlayback: framePlayback,
  getGroupPlaybackFps: groupPlaybackFps,
  getEffectiveFrameDurationMultiplier: effectiveFrameDurationMultiplier,
  getPlaybackChainGroup: () => {
    if (!els.chainGroupSelect) return null;
    return (config?.groups || []).find((group) => group.uiId === els.chainGroupSelect.value) || null;
  },
  chainGroupSelect: els.chainGroupSelect,
  setSingleFrameSelection,
  syncFrameInputs,
  renderFilmstrip,
  draw,
  selectGroup,
  playFrameAudio,
  playbackNeedsContinuousDraw,
  onError: (error) => status(t("loadFailed", { message: error.message })),
});
const {
  advancePlayback,
  animate,
  firstPlayableFrame,
  nextPlayableFrameInGroup,
  playbackChainGroup,
  schedulePlaybackAnimation,
  switchPlaybackGroup,
} = playback;
const boxSelection = globalThis.XSXBAppBoxSelection.createController({
  boxNames: BOX_NAMES,
  boxPrefKeys: BOX_PREF_KEYS,
  getSelectedBoxes: () => selectedBoxes,
  getSelectedBox: () => selectedBox,
  setSelectedBox: (value) => {
    selectedBox = value;
  },
  getCurrentGroup: () => currentGroup,
  canEditBox: (...args) => canEditBox(...args),
  getShowBoxes: () => showBoxes,
});
const { firstEditableSelectedBox, normalizeBoxSelectionForGroup, saveBoxViewPrefs, selectedBoxNames } =
  boxSelection;
const boxModel = globalThis.XSXBBoxModel.createController({
  boxNames: BOX_NAMES,
  getCurrentGroup: () => currentGroup,
  getConfig: () => config,
  getSelectedFrame: () => selectedFrame,
  getSelectedBox: () => selectedBox,
  setSelectedBox: (value) => {
    selectedBox = value;
  },
  getSelectedBoxes: () => selectedBoxes,
  getBoxOnlyMode: () => boxOnlyMode,
  setBoxOnlyMode: (value) => {
    boxOnlyMode = value;
  },
  getAdjustmentMode: () => adjustmentMode,
  getBoxOverrideStore: boxOverrideStore,
  getFrameBoxKey: frameBoxKey,
  defaultHitbox,
  defaultCollisionBox,
  defaultHurtbox,
  isCollisionBox,
  normalizeFrameBox,
  cloneVector,
  isAttackAnimationGroup,
  selectedFrameIndexes,
  normalizeBoxSelectionForGroup,
  saveBoxViewPrefs,
});
const {
  boxExistsOnFrame,
  boxOverride,
  boxScopeFrameIndexes,
  boxScopeGroups,
  canEditBox,
  canEditBoxes,
  combatBoxFacingForGroup,
  defaultSelectedBoxForGroup,
  frameBox,
  shouldPreviewPairedBox,
  snapshotBoxEntriesForGroups,
  syncBoxSelectionForGroup,
} = boxModel;
const boxTransform = globalThis.XSXBBoxTransform.createController({
  getCurrentGroup: () => currentGroup,
  getSelectedFrame: () => selectedFrame,
  getConfig: () => config,
  getAdjustmentMode: () => adjustmentMode,
  getBoxEditSnapshot: () => boxEditSnapshot,
  frameTransform,
  baseTransform,
  characterTransform,
  renderTransformForGroup,
  runtimeBaseScaleForGroup,
  combatBoxFacingForGroup,
  getBoxOverrideStore: boxOverrideStore,
  createBoxEditSnapshot,
  transformHasDelta,
  transformBoxByDelta,
  rotateVector,
  markDirty,
});
const {
  applyBoxTransformDelta,
  boxAutoTransform,
  boxOffsetDeltaFromScreenDelta,
  boxResizeDeltaFromScreenDelta,
  boxSpaceTransformForAdjustment,
  transformForAdjustmentMode,
} = boxTransform;
const canvasCoordinates = globalThis.XSXBCanvasCoordinates.createController({
  getCurrentGroup: () => currentGroup,
  getSelectedFrame: () => selectedFrame,
  getImages: () => images,
  getView: () => view,
  getDevicePixelRatio: () => devicePixelRatio,
  getConfig: () => config,
  runtimeBaseScaleForGroup,
});
const {
  coordinateGridStep,
  coordinateOrigin,
  coordinateScreenScale,
  coordinateToScreen,
  floorAlignmentDelta,
  floorReferenceLabel,
  floorTopReferenceOffset,
  groupOriginScreen,
  screenToCoordinate,
} = canvasCoordinates;
const boxAdjustmentModule = globalThis.XSXBAppBoxAdjustment;
if (!boxAdjustmentModule) throw new Error("XSXBAppBoxAdjustment is required.");
const boxAdjustment = boxAdjustmentModule.createController({
  elements: els,
  getCurrentGroup: () => currentGroup,
  getSelectedFrame: () => selectedFrame,
  getSelectedBox: () => selectedBox,
  getSelectedBoxes: () => selectedBoxes,
  getShowBoxes: () => showBoxes,
  getImages: () => images,
  getView: () => view,
  getDevicePixelRatio: () => devicePixelRatio,
  boxDrawOrder: BOX_DRAW_ORDER,
  collisionBoxHandles: COLLISION_BOX_HANDLES,
  boxExistsOnFrame,
  frameBox,
  boxAutoTransform,
  groupOriginScreen,
  isCollisionBox,
  rotateVector,
  rotatePoint,
  pointInRect,
  pointInBoxRect,
  canEditBoxes,
  canEditBox,
  normalizeBoxSelectionForGroup,
  saveBoxViewPrefs,
  selectedFrameIndexes,
  cloneVector,
  collisionOffsetYForHeight,
  setBoxOverride,
  renderFilmstrip,
  draw,
});
const {
  boxHandleRects,
  boxScreenRect,
  editableBoxHandleRects,
  hitTestBoxes,
  stagePoint,
  syncBoxInputs,
  updateSelectedBoxFromInputs,
} = boxAdjustment;
const sceneSettingsController = globalThis.XSXBAppSceneSettings.createController({
  elements: els,
  getConfig: () => config,
  getSelectedSceneId: () => selectedSceneId,
  setSelectedSceneId: (value) => {
    selectedSceneId = value;
  },
  getSceneSettings: () => sceneSettings,
  escapeHtml,
  round,
  nearlyEqual,
  translate: t,
  markDirty,
  updateSaveState,
  draw,
});
const {
  activeSceneId,
  activeSceneScale,
  collectSceneSettings,
  renderSceneSelect,
  sceneScaleFor,
  syncSceneInputs,
  updateSceneScaleFromInput,
} = sceneSettingsController;
const tunerUpdate = globalThis.XSXBAppUpdate.createController({
  elements: els,
  getDirty: () => dirty,
  translate: t,
  fetchImpl: globalThis.fetch,
  windowRef: globalThis,
});
const { check: checkTunerUpdate, install: installTunerUpdate, render: renderTunerUpdateStatus } = tunerUpdate;
const projectMutations = globalThis.XSXBProjectMutations.createController({
  elements: els,
  getConfig: () => config,
  getActiveProjectId: activeProjectId,
  getDirty: () => dirty,
  setDirty: (value) => {
    dirty = value;
  },
  setSelectedProjectId: (value) => {
    selectedProjectId = value;
  },
  confirm: requestAppConfirmation,
  fetchImpl: globalThis.fetch,
  translate: t,
  projectLabel,
  resetProjectSession,
  loadConfig,
  resizeCanvas: () => resizeCanvas(),
  renderProjectSelect,
  status,
});
const {
  activateProject,
  clearActiveProject,
  deleteActiveProject,
  readMutationResponse,
  setProjectMutationBusy,
} = projectMutations;
const attachmentState = globalThis.XSXBAttachmentState.createController({
  getConfig: () => config,
  getAttachments: () => frameImageAttachments,
  setAttachments: (value) => {
    frameImageAttachments = value;
  },
  setAssets: (value) => {
    attachmentAssets = value;
  },
  getSelectedAttachmentId: () => selectedAttachmentId,
  setSelectedAttachmentId: (value) => {
    selectedAttachmentId = value;
  },
  getSelectedFrame: () => selectedFrame,
  getCurrentGroup: () => currentGroup,
  getFrameKey: frameImageAttachmentKey,
  getFrameMetadata: frameImageAttachmentMetadata,
  normalizeAttachment: normalizeFrameImageAttachment,
  newLocalId,
  attachmentLayerOrder,
  selectedFrameIndexes,
  clampFrameIndex,
});
const {
  attachmentFrameIndex,
  directManipulationAttachment,
  drawableForFrame: drawableFrameAttachments,
  forFrame: frameImageAttachmentsForFrame,
  implicitSingleFrameAttachment,
  layerStackItems: frameLayerStackItems,
  loadAssetsFromProject: loadAttachmentAssetsFromProject,
  loadFromProject: loadFrameImageAttachmentsFromProject,
  nextAboveLayerOrder: nextAboveAttachmentLayerOrder,
  selectedAttachment: selectedFrameAttachment,
} = attachmentState;
const layerStack = globalThis.XSXBLayerStack.createController({
  getCurrentGroup: () => currentGroup,
  getFrameLayerStackItems: frameLayerStackItems,
  getFrameImageAttachments: () => frameImageAttachments,
  getFrameImageAttachmentKey: frameImageAttachmentKey,
  getFrameImageAttachmentMetadata: frameImageAttachmentMetadata,
  clampFrameIndex,
});
const {
  applyFrameLayerCardOrder,
  layerCardDomKey,
  layerCardInfoForAttachment,
  layerCardInfoForMain,
  layerCardInfosForFrame,
  layerCardKey,
  movedLayerCardOrder,
} = layerStack;
const imageCacheController = globalThis.XSXBImageCache.createController({
  getImageCache: () => imageCache,
  getImageElements: () => imageElements,
  getOpaqueRectCache: () => opaqueRectCache,
  getConfig: () => config,
  preloadFrameLimit: PRELOAD_FRAME_LIMIT,
  preloadConcurrency: PRELOAD_CONCURRENCY,
  mapWithConcurrency,
  assetUrl,
  status,
  translate: t,
  imageConstructor: globalThis.Image,
  documentRef: globalThis.document,
});
const {
  cachedImageForFrame,
  imageCacheKey,
  loadImageCached,
  loadImagesBounded,
  opaqueRectForImage,
  startPreloadImages,
} = imageCacheController;
const compositeContext = globalThis.XSXBCompositeContext.createController({
  getConfig: () => config,
  getCurrentGroup: () => currentGroup,
  getChainImages: () => chainImages,
  setChainImages: (value) => {
    chainImages = value;
  },
  getPreviewOwnerGroup: () => previewOwnerGroup,
  setPreviewOwnerGroup: (value) => {
    previewOwnerGroup = value;
  },
  getPreviewOwnerImages: () => previewOwnerImages,
  setPreviewOwnerImages: (value) => {
    previewOwnerImages = value;
  },
  getCoordinateOwnerGroup: () => coordinateOwnerGroup,
  setCoordinateOwnerGroup: (value) => {
    coordinateOwnerGroup = value;
  },
  getCoordinateOwnerImages: () => coordinateOwnerImages,
  setCoordinateOwnerImages: (value) => {
    coordinateOwnerImages = value;
  },
  getAttachedLayerImageSets: () => attachedLayerImageSets,
  setAttachedLayerImageSets: (value) => {
    attachedLayerImageSets = value;
  },
  getPlaybackChainGroup: playbackChainGroup,
  getImagesLoader: () => imageCacheController,
  getAttachmentFrames: frameImageAttachmentsForFrame,
  getImageCacheKey: imageCacheKey,
  mapWithConcurrency,
});
const {
  attachedLayerGroups,
  findRelatedGroup,
  loadChainImages: loadChainImagesFromContext,
  loadCompositeContext: loadCompositeContextFromContext,
  loadFrameImageAttachmentsForGroup: loadFrameImageAttachmentsForGroupFromContext,
} = compositeContext;
const history = globalThis.XSXBHistory.createController({
  elements: els,
  getUndoStack: () => undoStack,
  setUndoStack: (value) => {
    undoStack = value;
  },
  getRedoStack: () => redoStack,
  setRedoStack: (value) => {
    redoStack = value;
  },
  getSnapshot: cloneState,
  restoreSnapshot: restoreHistoryState,
  markDirty,
  status,
  translate: t,
});
const { pushUndo, redo, undo, updateHistoryControls } = history;

const projectLifecycleModule = globalThis.XSXBAppProjectLifecycle;
if (!projectLifecycleModule) throw new Error("XSXBAppProjectLifecycle is required.");

/**
 * Binds a mutable app.js variable to the lifecycle controller state facade.
 * @param {object} target State facade receiving the property.
 * @param {string} key State property name.
 * @param {()=>unknown} getter Reads the current local variable.
 * @param {(value:unknown)=>void} setter Writes the local variable.
 * @returns {object} The updated state facade.
 */
const bindLifecycleState = (target, key, getter, setter) =>
  Object.defineProperty(target, key, { configurable: true, enumerable: true, get: getter, set: setter });
const lifecycleState = { elements: els };
[
  ["config", () => config, (value) => (config = value)],
  ["selectedProjectId", () => selectedProjectId, (value) => (selectedProjectId = value)],
  ["currentGroup", () => currentGroup, (value) => (currentGroup = value)],
  ["selectedFrame", () => selectedFrame, (value) => (selectedFrame = value)],
  ["selectedFrames", () => selectedFrames, (value) => (selectedFrames = value)],
  ["selectionAnchorFrame", () => selectionAnchorFrame, (value) => (selectionAnchorFrame = value)],
  ["selectedProfileId", () => selectedProfileId, (value) => (selectedProfileId = value)],
  ["playing", () => playing, (value) => (playing = value)],
  ["playbackPrimaryGroup", () => playbackPrimaryGroup, (value) => (playbackPrimaryGroup = value)],
  ["playbackSecondaryGroup", () => playbackSecondaryGroup, (value) => (playbackSecondaryGroup = value)],
  ["playbackSwitching", () => playbackSwitching, (value) => (playbackSwitching = value)],
  ["images", () => images, (value) => (images = value)],
  ["chainImages", () => chainImages, (value) => (chainImages = value)],
  ["previewOwnerGroup", () => previewOwnerGroup, (value) => (previewOwnerGroup = value)],
  ["previewOwnerImages", () => previewOwnerImages, (value) => (previewOwnerImages = value)],
  ["coordinateOwnerGroup", () => coordinateOwnerGroup, (value) => (coordinateOwnerGroup = value)],
  ["coordinateOwnerImages", () => coordinateOwnerImages, (value) => (coordinateOwnerImages = value)],
  ["attachedLayerImageSets", () => attachedLayerImageSets, (value) => (attachedLayerImageSets = value)],
  ["referenceFrame", () => referenceFrame, (value) => (referenceFrame = value)],
  ["undoStack", () => undoStack, (value) => (undoStack = value)],
  ["redoStack", () => redoStack, (value) => (redoStack = value)],
  ["imageCache", () => imageCache, (value) => (imageCache = value)],
  ["imageElements", () => imageElements, (value) => (imageElements = value)],
  ["opaqueRectCache", () => opaqueRectCache, (value) => (opaqueRectCache = value)],
  ["huangXianAnchorXCache", () => huangXianAnchorXCache, (value) => (huangXianAnchorXCache = value)],
  ["selectedAttachmentId", () => selectedAttachmentId, (value) => (selectedAttachmentId = value)],
  ["values", () => values, (value) => (values = value)],
  ["bossValues", () => bossValues, (value) => (bossValues = value)],
  ["act2StatueBossValues", () => act2StatueBossValues, (value) => (act2StatueBossValues = value)],
  ["huangXianValues", () => huangXianValues, (value) => (huangXianValues = value)],
  ["soulValues", () => soulValues, (value) => (soulValues = value)],
  ["yechengPropValues", () => yechengPropValues, (value) => (yechengPropValues = value)],
  ["sceneSettings", () => sceneSettings, (value) => (sceneSettings = value)],
  ["frameOverrides", () => frameOverrides, (value) => (frameOverrides = value)],
  ["vfxFrameOverrides", () => vfxFrameOverrides, (value) => (vfxFrameOverrides = value)],
  ["framePlaybackOverrides", () => framePlaybackOverrides, (value) => (framePlaybackOverrides = value)],
  ["vfxPlaybackOverrides", () => vfxPlaybackOverrides, (value) => (vfxPlaybackOverrides = value)],
  ["frameBoxOverrides", () => frameBoxOverrides, (value) => (frameBoxOverrides = value)],
  ["bossFrameOverrides", () => bossFrameOverrides, (value) => (bossFrameOverrides = value)],
  ["bossPlaybackOverrides", () => bossPlaybackOverrides, (value) => (bossPlaybackOverrides = value)],
  [
    "act2StatueBossFrameOverrides",
    () => act2StatueBossFrameOverrides,
    (value) => (act2StatueBossFrameOverrides = value),
  ],
  [
    "act2StatueBossPlaybackOverrides",
    () => act2StatueBossPlaybackOverrides,
    (value) => (act2StatueBossPlaybackOverrides = value),
  ],
  ["huangXianFrameOverrides", () => huangXianFrameOverrides, (value) => (huangXianFrameOverrides = value)],
  [
    "huangXianPlaybackOverrides",
    () => huangXianPlaybackOverrides,
    (value) => (huangXianPlaybackOverrides = value),
  ],
  ["soulFrameOverrides", () => soulFrameOverrides, (value) => (soulFrameOverrides = value)],
  ["soulPlaybackOverrides", () => soulPlaybackOverrides, (value) => (soulPlaybackOverrides = value)],
  ["soulFrameBoxOverrides", () => soulFrameBoxOverrides, (value) => (soulFrameBoxOverrides = value)],
  [
    "yechengPropFrameOverrides",
    () => yechengPropFrameOverrides,
    (value) => (yechengPropFrameOverrides = value),
  ],
].forEach(([key, getter, setter]) => bindLifecycleState(lifecycleState, key, getter, setter));
const eventState = lifecycleState;
[
  ["batchCutout", () => batchCutout, (value) => (batchCutout = value)],
  ["adjustmentMode", () => adjustmentMode, (value) => (adjustmentMode = value)],
  ["baseEditSnapshot", () => baseEditSnapshot, (value) => (baseEditSnapshot = value)],
  ["boxEditSnapshot", () => boxEditSnapshot, (value) => (boxEditSnapshot = value)],
  ["boxOnlyMode", () => boxOnlyMode, (value) => (boxOnlyMode = value)],
  ["canvasColor", () => canvasColor, (value) => (canvasColor = value)],
  ["drag", () => drag, (value) => (drag = value)],
  ["frameImageAttachments", () => frameImageAttachments, (value) => (frameImageAttachments = value)],
  [
    "frameImageAttachmentClipboard",
    () => frameImageAttachmentClipboard,
    (value) => (frameImageAttachmentClipboard = value),
  ],
  [
    "frameImageAttachmentClipboardProjectId",
    () => frameImageAttachmentClipboardProjectId,
    (value) => (frameImageAttachmentClipboardProjectId = value),
  ],
  ["frameAudioBindings", () => frameAudioBindings, (value) => (frameAudioBindings = value)],
  ["frameOrganizer", () => frameOrganizer, (value) => (frameOrganizer = value)],
  ["ghost", () => ghost, (value) => (ghost = value)],
  ["groupSearch", () => groupSearch, (value) => (groupSearch = value)],
  [
    "heldAttachmentTransformKeys",
    () => heldAttachmentTransformKeys,
    (value) => (heldAttachmentTransformKeys = value),
  ],
  ["inputEditSnapshots", () => inputEditSnapshots, (value) => (inputEditSnapshots = value)],
  ["language", () => language, (value) => (language = value)],
  ["lastPlay", () => lastPlay, (value) => (lastPlay = value)],
  ["pointerStagePoint", () => pointerStagePoint, (value) => (pointerStagePoint = value)],
  ["selectedBox", () => selectedBox, (value) => (selectedBox = value)],
  ["selectedBoxes", () => selectedBoxes, (value) => (selectedBoxes = value)],
  ["selectedSceneId", () => selectedSceneId, (value) => (selectedSceneId = value)],
  ["dirty", () => dirty, (value) => (dirty = value)],
  ["editRevision", () => editRevision, (value) => (editRevision = value)],
  ["saveInFlight", () => saveInFlight, (value) => (saveInFlight = value)],
  ["lastSavedAt", () => lastSavedAt, (value) => (lastSavedAt = value)],
  ["showBoxes", () => showBoxes, (value) => (showBoxes = value)],
  ["stageViewMode", () => stageViewMode, (value) => (stageViewMode = value)],
  ["uiTheme", () => uiTheme, (value) => (uiTheme = value)],
  ["view", () => view, (value) => (view = value)],
].forEach(([key, getter, setter]) => bindLifecycleState(eventState, key, getter, setter));
const projectStateModule = globalThis.XSXBAppProjectState;
if (!projectStateModule) throw new Error("XSXBAppProjectState is required.");
projectStateController = projectStateModule.createController({
  state: eventState,
  elements: els,
  messages: I18N,
  documentRef: globalThis.document,
  windowRef: globalThis,
  confirm: requestAppConfirmation,
  storage: globalThis.localStorage,
  projectLabel,
  groupLabel,
  escapeHtml,
  frameImageAttachmentClipboardItem,
  normalizeFrameImageAttachment,
  newLocalId,
  groupPlaybackFrame: GROUP_PLAYBACK_FRAME,
  renderTunerUpdateStatus: () => renderTunerUpdateStatus(),
  renderHomeHub: () => renderHomeHub(),
  renderSceneSelect: () => renderSceneSelect(),
  renderProfileSelect: () => renderProfileSelect(),
  renderGroupSelect: (...args) => renderGroupSelect(...args),
  renderChainGroupSelect: () => renderChainGroupSelect(),
  renderFilmstrip: () => renderFilmstrip(),
  syncFrameAudioInputs: () => syncFrameAudioInputs(),
  updateCanvasTitle: () => updateCanvasTitle(),
  updateCoordHud: () => updateCoordHud(),
  updateHistoryControls: () => updateHistoryControls(),
  syncAdjustmentInputs: () => syncAdjustmentInputs(),
  syncFrameInputs: () => syncFrameInputs(),
  draw,
  setAdjustmentMode: (...args) => setAdjustmentMode(...args),
  setSingleFrameSelection: (...args) => setSingleFrameSelection(...args),
  selectedFrameIndexes: (...args) => selectedFrameIndexes(...args),
  selectedFrameAttachment: (...args) => selectedFrameAttachment(...args),
  frameImageAttachmentsForFrame: (...args) => frameImageAttachmentsForFrame(...args),
  directManipulationAttachment: (...args) => directManipulationAttachment(...args),
  pushUndo: (...args) => pushUndo(...args),
  loadImageCached: (...args) => loadImageCached(...args),
  resetProjectSession: (...args) => resetProjectSession(...args),
  loadConfig: (...args) => loadConfig(...args),
  resizeCanvas: (...args) => resizeCanvas(...args),
});
const projectLifecycle = projectLifecycleModule.createController({
  state: lifecycleState,
  fetchImpl: browserOnlyMode ? browserRuntime.fetchConfig : globalThis.fetch,
  translate: t,
  getGroupSearch: () => groupSearch,
  loadFrameImageAttachmentsFromProject,
  loadAttachmentAssetsFromProject,
  resetFrameAudioBindings,
  loadFrameAudioBindingsFromProject,
  loadFrameAudioBindingsFromDb,
  syncFrameAudioBindingsToGame,
  getFrameAudioBindings: () => frameAudioBindings,
  renderProjectSelect,
  renderSceneSelect,
  renderProfileSelect,
  renderGroupSelect,
  renderChainGroupSelect,
  updateSaveState,
  updateHistoryControls,
  loadedStatusText,
  status,
  updateWorkbenchHud,
  draw,
  startPreloadImages,
  loadImagesBounded,
  loadImageCached,
  loadChainImagesImpl: loadChainImagesFromContext,
  loadCompositeContextImpl: loadCompositeContextFromContext,
  loadFrameImageAttachmentsForGroupImpl: loadFrameImageAttachmentsForGroupFromContext,
  framePlayback,
  firstPlayableFrame,
  setFrameSelection,
  setSingleFrameSelection,
  updateCanvasTitle,
  updateGroupMeta,
  syncBoxSelectionForGroup,
  syncBaseInputs,
  syncFrameInputs,
  syncGroupPlaybackInputs,
  syncGroupTimeInputs,
  renderFilmstrip,
  fitView: (...args) => fitView(...args),
  syncUrlState,
});
const tuningValuesModule = globalThis.XSXBAppTuningValues;
if (!tuningValuesModule) throw new Error("XSXBAppTuningValues is required.");
const tuningValues = tuningValuesModule.createController({
  getConfig: () => config,
  getValues: () => values,
  getBossValues: () => bossValues,
  getAct2StatueBossValues: () => act2StatueBossValues,
  getHuangXianValues: () => huangXianValues,
  getSoulValues: () => soulValues,
  getYechengPropValues: () => yechengPropValues,
});
const saveControllerModule = globalThis.XSXBAppSave;
if (!saveControllerModule) throw new Error("XSXBAppSave is required.");
const saveController = saveControllerModule.createController({
  getConfig: () => config,
  getCurrentGroup: () => currentGroup,
  getImages: () => images,
  getSaveInFlight: () => saveInFlight,
  setSaveInFlight: (value) => {
    saveInFlight = value;
  },
  getEditRevision: () => editRevision,
  setDirty: (value) => {
    dirty = value;
  },
  getActiveProjectId: activeProjectId,
  updateSaveState,
  updateAdjustmentFromInputs: () => updateAdjustmentFromInputs(),
  pruneNoopFrameOverrides,
  collectFrameAudioBindingsForSave,
  canEditBox,
  mapWithConcurrency,
  loadImageCached,
  boxOverrideStore,
  frameBoxKey,
  defaultCollisionBox,
  normalizeFrameBox,
  collectTuningValues: tuningValues.collectTuningValues,
  collectBossTuningValues: tuningValues.collectBossTuningValues,
  collectAct2StatueBossTuningValues: tuningValues.collectAct2StatueBossTuningValues,
  collectHuangXianTuningValues: tuningValues.collectHuangXianTuningValues,
  collectSoulTuningValues: tuningValues.collectSoulTuningValues,
  collectYechengPropTuningValues: tuningValues.collectYechengPropTuningValues,
  collectSceneSettings,
  collectFrameImageAttachmentsForSave: (...args) => attachmentCollectForSave(...args),
  getFrameOverrides: () => frameOverrides,
  getVfxFrameOverrides: () => vfxFrameOverrides,
  getFramePlaybackOverrides: () => framePlaybackOverrides,
  getVfxPlaybackOverrides: () => vfxPlaybackOverrides,
  getFrameBoxOverrides: () => frameBoxOverrides,
  getBossFrameOverrides: () => bossFrameOverrides,
  getBossPlaybackOverrides: () => bossPlaybackOverrides,
  getAct2StatueBossFrameOverrides: () => act2StatueBossFrameOverrides,
  getAct2StatueBossPlaybackOverrides: () => act2StatueBossPlaybackOverrides,
  getHuangXianFrameOverrides: () => huangXianFrameOverrides,
  getHuangXianPlaybackOverrides: () => huangXianPlaybackOverrides,
  getSoulFrameOverrides: () => soulFrameOverrides,
  getSoulPlaybackOverrides: () => soulPlaybackOverrides,
  getSoulFrameBoxOverrides: () => soulFrameBoxOverrides,
  premiumFeatures,
  ensurePremiumActivated,
  fetchImpl: globalThis.fetch,
  markClean,
  status,
  translate: t,
  cloneValue: (value) => structuredClone(value),
});

const adjustmentInputsModule = globalThis.XSXBAppAdjustmentInputs;
if (!adjustmentInputsModule) throw new Error("XSXBAppAdjustmentInputs is required.");
adjustmentInputsController = adjustmentInputsModule.createController({
  elements: els,
  adjustmentModes: ADJUSTMENT_MODES,
  adjustmentModeKey: ADJUSTMENT_MODE_KEY,
  getAdjustmentMode: () => adjustmentMode,
  setAdjustmentMode: (value) => {
    adjustmentMode = value;
  },
  getCurrentGroup: () => currentGroup,
  getSelectedFrame: () => selectedFrame,
  getSelectedFrameAttachment: selectedFrameAttachment,
  groupSupports,
  canEditGroupTransform,
  canEditFrameTransform,
  characterTransform,
  frameTransform,
  baseTransform,
  normalizeAttachmentTransform,
  characterBaseScaleForGroup,
  framePlayback,
  frameDurationMs,
  canEditFramePlayback,
  isReferenceFrame,
  canUseReferenceFrame,
  usesAttachedPlaybackTiming,
  groupPlaybackFps,
  groupRootMotion,
  attachedPlaybackOwnerGroup,
  attachedVfxPlaybackWindow,
  syncGroupTimeInputs,
  updateCanvasTitle,
  updateWorkbenchHud,
  syncBoxInputs,
  syncFrameAudioInputs,
  updateAdjustmentFromInputs: () => updateAdjustmentFromInputs(),
  pushUndo,
  createBoxEditSnapshot,
  setBaseEditSnapshot: (value) => {
    baseEditSnapshot = value;
  },
  setBoxEditSnapshot: (value) => {
    boxEditSnapshot = value;
  },
  overrideStore,
  round,
  documentRef: globalThis.document,
  localStorageRef: globalThis.localStorage,
});

const frameEditStateModule = globalThis.XSXBAppFrameEditState;
if (!frameEditStateModule) throw new Error("XSXBAppFrameEditState is required.");
frameEditStateController = frameEditStateModule.createController({
  boxNames: BOX_NAMES,
  getConfig: () => config,
  getCurrentGroup: () => currentGroup,
  getSelectedFrame: () => selectedFrame,
  getImages: () => images,
  getAdjustmentMode: () => adjustmentMode,
  getFrameAudioBinding: () => frameAudioBinding(),
  baseTransform,
  overrideStore,
  boxOverrideStore,
  frameBox,
  tuningFrameKey,
  groupOwnsFrameKey,
  normalizeFrameBox,
  cloneScaleVector,
  cloneVector,
  scaleVectorFromTransform,
  nearlyEqual,
  markDirty,
  usesCanvasLeftBottomAnchor,
  usesCanvasBottomCenterAnchor,
  opaqueRectForImage,
  boxScopeGroups,
  boxScopeFrameIndexes,
  boxSpaceTransformForAdjustment,
  transformForAdjustmentMode,
  snapshotBoxEntriesForGroups,
  elements: els,
  translate: (...args) => t(...args),
});

function t(...args) {
  return projectStateCall("t", ...args);
}
function applyLanguage(...args) {
  return projectStateCall("applyLanguage", ...args);
}
function normalizeTheme(...args) {
  return projectStateCall("normalizeTheme", ...args);
}
function normalizeColor(...args) {
  return projectStateCall("normalizeColor", ...args);
}
function applyUiTheme(...args) {
  return projectStateCall("applyUiTheme", ...args);
}
function applyCanvasColor(...args) {
  return projectStateCall("applyCanvasColor", ...args);
}
function status(...args) {
  return projectStateCall("status", ...args);
}
function loadedStatusText(...args) {
  return projectStateCall("loadedStatusText", ...args);
}
function updateSaveState(...args) {
  return projectStateCall("updateSaveState", ...args);
}
function markDirty(...args) {
  return projectStateCall("markDirty", ...args);
}
function markClean(...args) {
  return projectStateCall("markClean", ...args);
}

async function refreshActiveProject(...args) {
  return projectStateCall("refreshActiveProject", ...args);
}

function keyFor(...args) {
  return projectStateCall("keyFor", ...args);
}
function tuningAnimationName(...args) {
  return projectStateCall("tuningAnimationName", ...args);
}
function sourceFrameIndex(...args) {
  return projectStateCall("sourceFrameIndex", ...args);
}
function tuningFrameKey(...args) {
  return projectStateCall("tuningFrameKey", ...args);
}
function activeProjectId(...args) {
  return projectStateCall("activeProjectId", ...args);
}
function frameAudioKey(...args) {
  return projectStateCall("frameAudioKey", ...args);
}
function frameAudioMetadata(...args) {
  return projectStateCall("frameAudioMetadata", ...args);
}
function frameAudioMetadataFromKey(...args) {
  return projectStateCall("frameAudioMetadataFromKey", ...args);
}
function frameImageAttachmentKey(...args) {
  return projectStateCall("frameImageAttachmentKey", ...args);
}
function frameImageAttachmentMetadata(...args) {
  return projectStateCall("frameImageAttachmentMetadata", ...args);
}
function canDirectManipulateSelectedAttachment(...args) {
  return projectStateCall("canDirectManipulateSelectedAttachment", ...args);
}
function activateFrameAttachmentForEditing(...args) {
  return projectStateCall("activateFrameAttachmentForEditing", ...args);
}
function selectFrameImageAttachment(...args) {
  return projectStateCall("selectFrameImageAttachment", ...args);
}
function clearSelectedAttachment(...args) {
  return projectStateCall("clearSelectedAttachment", ...args);
}
function copyFrameImageAttachments(...args) {
  return projectStateCall("copyFrameImageAttachments", ...args);
}
function pasteFrameImageAttachments(...args) {
  return projectStateCall("pasteFrameImageAttachments", ...args);
}
function frameAudioBinding(...args) {
  return projectStateCall("frameAudioBinding", ...args);
}
function revokeFrameAudioBinding(...args) {
  return projectStateCall("revokeFrameAudioBinding", ...args);
}
function resetFrameAudioBindings(...args) {
  return projectStateCall("resetFrameAudioBindings", ...args);
}
function frameAudioKeyFromBinding(...args) {
  return projectStateCall("frameAudioKeyFromBinding", ...args);
}
function loadFrameAudioBindingsFromProject(...args) {
  return projectStateCall("loadFrameAudioBindingsFromProject", ...args);
}
function groupPlaybackKey(...args) {
  return projectStateCall("groupPlaybackKey", ...args);
}
function groupOwnsFrameKey(...args) {
  return projectStateCall("groupOwnsFrameKey", ...args);
}
function overrideStore(...args) {
  return projectStateCall("overrideStore", ...args);
}
function playbackStore(...args) {
  return projectStateCall("playbackStore", ...args);
}
function boxOverrideStore(...args) {
  return projectStateCall("boxOverrideStore", ...args);
}
function valueStore(...args) {
  return projectStateCall("valueStore", ...args);
}
function groupSupports(...args) {
  return projectStateCall("groupSupports", ...args);
}
function canEditGroupTransform(...args) {
  return projectStateCall("canEditGroupTransform", ...args);
}
function canEditFrameTransform(...args) {
  return projectStateCall("canEditFrameTransform", ...args);
}
function canEditFramePlayback(...args) {
  return projectStateCall("canEditFramePlayback", ...args);
}
function canUseReferenceFrame(...args) {
  return projectStateCall("canUseReferenceFrame", ...args);
}
function resetProjectSession() {
  return projectLifecycle.resetProjectSession();
}

function updateGroupMeta() {}

async function loadConfig() {
  return projectLifecycle.loadConfig();
}

async function selectGroup(group, options = {}) {
  return projectLifecycle.selectGroup(group, options);
}

function loadChainImages(chain) {
  return projectLifecycle.loadChainImages(chain);
}

function loadCompositeContext(group) {
  return projectLifecycle.loadCompositeContext(group);
}

function loadFrameImageAttachmentsForGroup(group) {
  return projectLifecycle.loadFrameImageAttachmentsForGroup(group);
}

function cloneState() {
  return {
    values: structuredClone(values),
    bossValues: structuredClone(bossValues),
    act2StatueBossValues: structuredClone(act2StatueBossValues),
    huangXianValues: structuredClone(huangXianValues),
    soulValues: structuredClone(soulValues),
    yechengPropValues: structuredClone(yechengPropValues),
    sceneSettings: structuredClone(sceneSettings),
    selectedSceneId,
    frameImageAttachments: structuredClone(frameImageAttachments),
    selectedAttachmentId,
    frameOverrides: structuredClone(frameOverrides),
    vfxFrameOverrides: structuredClone(vfxFrameOverrides),
    framePlaybackOverrides: structuredClone(framePlaybackOverrides),
    vfxPlaybackOverrides: structuredClone(vfxPlaybackOverrides),
    frameBoxOverrides: structuredClone(frameBoxOverrides),
    bossFrameOverrides: structuredClone(bossFrameOverrides),
    bossPlaybackOverrides: structuredClone(bossPlaybackOverrides),
    act2StatueBossFrameOverrides: structuredClone(act2StatueBossFrameOverrides),
    act2StatueBossPlaybackOverrides: structuredClone(act2StatueBossPlaybackOverrides),
    huangXianFrameOverrides: structuredClone(huangXianFrameOverrides),
    huangXianPlaybackOverrides: structuredClone(huangXianPlaybackOverrides),
    soulFrameOverrides: structuredClone(soulFrameOverrides),
    soulPlaybackOverrides: structuredClone(soulPlaybackOverrides),
    soulFrameBoxOverrides: structuredClone(soulFrameBoxOverrides),
    yechengPropFrameOverrides: structuredClone(yechengPropFrameOverrides),
    selectedFrame,
    selectedFrames: Array.from(selectedFrames),
    selectionAnchorFrame,
    groupName: currentGroup?.uiId,
  };
}

function restoreHistoryState(state) {
  values = structuredClone(state.values);
  bossValues = structuredClone(state.bossValues);
  act2StatueBossValues = structuredClone(state.act2StatueBossValues || {});
  huangXianValues = structuredClone(state.huangXianValues || {});
  soulValues = structuredClone(state.soulValues || {});
  yechengPropValues = structuredClone(state.yechengPropValues || {});
  sceneSettings = structuredClone(state.sceneSettings || {});
  selectedSceneId = state.selectedSceneId || selectedSceneId;
  frameImageAttachments = structuredClone(state.frameImageAttachments || []);
  selectedAttachmentId = state.selectedAttachmentId || "";
  frameOverrides = structuredClone(state.frameOverrides);
  vfxFrameOverrides = structuredClone(state.vfxFrameOverrides);
  framePlaybackOverrides = structuredClone(state.framePlaybackOverrides);
  vfxPlaybackOverrides = structuredClone(state.vfxPlaybackOverrides);
  frameBoxOverrides = structuredClone(state.frameBoxOverrides || {});
  bossFrameOverrides = structuredClone(state.bossFrameOverrides);
  bossPlaybackOverrides = structuredClone(state.bossPlaybackOverrides);
  act2StatueBossFrameOverrides = structuredClone(state.act2StatueBossFrameOverrides || {});
  act2StatueBossPlaybackOverrides = structuredClone(state.act2StatueBossPlaybackOverrides || {});
  huangXianFrameOverrides = structuredClone(state.huangXianFrameOverrides || {});
  huangXianPlaybackOverrides = structuredClone(state.huangXianPlaybackOverrides || {});
  soulFrameOverrides = structuredClone(state.soulFrameOverrides || {});
  soulPlaybackOverrides = structuredClone(state.soulPlaybackOverrides || {});
  soulFrameBoxOverrides = structuredClone(state.soulFrameBoxOverrides || {});
  yechengPropFrameOverrides = structuredClone(state.yechengPropFrameOverrides || {});
  const group = config.groups.find((entry) => entry.uiId === state.groupName) || currentGroup;
  renderSceneSelect();
  syncSceneInputs();
  return selectGroup(group, {
    frameIndex: state.selectedFrame,
    selectedFrames: state.selectedFrames,
    selectionAnchorFrame: state.selectionAnchorFrame,
    selectedAttachmentId,
  });
}

function updateWorkbenchHud(group = currentGroup) {
  const frameCount = group?.frames?.length || 0;
  const selectionCount = selectedFrameCount();
  if (els.selectionHud) {
    const playable = playableFrameCount(group);
    const fps = group ? round(groupPlaybackFps(group)) : "-";
    const duration = group ? `${round(groupPlaybackDurationSeconds(group))}s` : "-";
    els.selectionHud.textContent = frameCount
      ? `${t("frame")} ${selectedFrame + 1}/${frameCount} - ${t("selectedFrames", { count: selectionCount })} - ${t("playable", { count: playable })} - ${fps} fps - ${duration}`
      : `${t("frame")} -`;
  }
}

function updateCanvasTitle(group = currentGroup) {
  if (!group) {
    els.canvasTitle.textContent = t("canvas");
    updateWorkbenchHud(null);
    updateDocumentTitle();
    return;
  }
  const count = selectedFrameCount();
  els.canvasTitle.textContent = `${group.name} - ${t("frameCountLabel", { count: group.frames.length })}${count > 1 ? ` - ${t("selectedFrames", { count })}` : ""}`;
  updateWorkbenchHud(group);
  updateDocumentTitle();
}

function frameTransform(index = selectedFrame, group = currentGroup) {
  return frameEditStateCall("frameTransform", index, group);
}

function hasFrameTransformOverride(index = selectedFrame, group = currentGroup) {
  return frameEditStateCall("hasFrameTransformOverride", index, group);
}

function setFrameTransform(index, transform) {
  return frameEditStateCall("setFrameTransform", index, transform);
}

function frameBoxKey(index = selectedFrame, group = currentGroup) {
  return frameEditStateCall("frameBoxKey", index, group);
}

function sourceFrameSize(index = selectedFrame, group = currentGroup, groupImages = images) {
  return frameEditStateCall("sourceFrameSize", index, group, groupImages);
}

function sourceAnchorForBox(index = selectedFrame, group = currentGroup, groupImages = images) {
  return frameEditStateCall("sourceAnchorForBox", index, group, groupImages);
}

function sourceRectForBox(index = selectedFrame, group = currentGroup, groupImages = images) {
  return frameEditStateCall("sourceRectForBox", index, group, groupImages);
}

function sourceBodyCenterForBox(index = selectedFrame, group = currentGroup, groupImages = images) {
  return frameEditStateCall("sourceBodyCenterForBox", index, group, groupImages);
}

function setBoxOverride(boxName, box, index = selectedFrame, group = currentGroup) {
  return frameEditStateCall("setBoxOverride", boxName, box, index, group);
}

function deleteBoxOnFrame(boxName, index = selectedFrame, group = currentGroup) {
  return frameEditStateCall("deleteBoxOnFrame", boxName, index, group);
}

function clearBoxOverride(boxName, index = selectedFrame, group = currentGroup) {
  return frameEditStateCall("clearBoxOverride", boxName, index, group);
}

function createBoxEditSnapshot(mode = adjustmentMode) {
  return frameEditStateCall("createBoxEditSnapshot", mode);
}

function syncFrameAudioInputs() {
  return frameEditStateCall("syncFrameAudioInputs");
}

function pruneNoopFrameOverrides() {
  return frameEditStateCall("pruneNoopFrameOverrides");
}

function canEditCharacterTransform(...args) {
  return adjustmentInputsCall("canEditCharacterTransform", ...args);
}

function canEditAdjustmentMode(...args) {
  return adjustmentInputsCall("canEditAdjustmentMode", ...args);
}

function normalizeAdjustmentMode(...args) {
  return adjustmentInputsCall("normalizeAdjustmentMode", ...args);
}

function adjustmentTransform(...args) {
  return adjustmentInputsCall("adjustmentTransform", ...args);
}

function transformFromAdjustmentInputs(...args) {
  return adjustmentInputsCall("transformFromAdjustmentInputs", ...args);
}

function adjustmentNumberInputs(...args) {
  return adjustmentInputsCall("adjustmentNumberInputs", ...args);
}

function adjustmentStepButtonsForInput(...args) {
  return adjustmentInputsCall("adjustmentStepButtonsForInput", ...args);
}

function beginStepAdjustmentEdit(...args) {
  return adjustmentInputsCall("beginStepAdjustmentEdit", ...args);
}

function endStepAdjustmentEdit(...args) {
  return adjustmentInputsCall("endStepAdjustmentEdit", ...args);
}

function stepAdjustmentInput(...args) {
  return adjustmentInputsCall("stepAdjustmentInput", ...args);
}

function stepOffsetByArrowKey(...args) {
  return adjustmentInputsCall("stepOffsetByArrowKey", ...args);
}

function syncAdjustmentModeInputs(...args) {
  return adjustmentInputsCall("syncAdjustmentModeInputs", ...args);
}

function syncAdjustmentInputs(...args) {
  return adjustmentInputsCall("syncAdjustmentInputs", ...args);
}

function syncBaseInputs(...args) {
  return adjustmentInputsCall("syncBaseInputs", ...args);
}

function syncCharacterBaseInputs(...args) {
  return adjustmentInputsCall("syncCharacterBaseInputs", ...args);
}

function syncFrameInputs(...args) {
  return adjustmentInputsCall("syncFrameInputs", ...args);
}

function syncGroupPlaybackInputs(...args) {
  return adjustmentInputsCall("syncGroupPlaybackInputs", ...args);
}

function selectFilmstripFrame(index, event = null) {
  clearSelectedAttachment();
  const frameIndex = clampFrameIndex(index, currentGroup);
  if (event?.shiftKey) {
    const anchor = clampFrameIndex(selectionAnchorFrame, currentGroup);
    const start = Math.min(anchor, frameIndex);
    const end = Math.max(anchor, frameIndex);
    selectedFrame = frameIndex;
    selectedFrames = new Set();
    for (let selectionIndex = start; selectionIndex <= end; selectionIndex += 1) {
      selectedFrames.add(selectionIndex);
    }
  } else if (event?.ctrlKey || event?.metaKey) {
    if (selectedFrames.has(frameIndex) && selectedFrames.size > 1) {
      selectedFrames.delete(frameIndex);
      selectedFrame = selectedFrame === frameIndex ? selectedFrameIndexes()[0] : selectedFrame;
    } else {
      selectedFrames.add(frameIndex);
      selectedFrame = frameIndex;
    }
    selectionAnchorFrame = selectedFrame;
  } else {
    setSingleFrameSelection(frameIndex, currentGroup);
  }
  playing = false;
  playbackPrimaryGroup = null;
  if (els.playPause) els.playPause.textContent = t("play");
  updateCanvasTitle();
  syncFrameInputs();
  renderFilmstrip();
  draw();
  syncUrlState();
}

function audioFileFromList(fileList) {
  const files = Array.from(fileList || []);
  return (
    files.find((file) => {
      if (!file) return false;
      if (String(file.type || "").startsWith("audio/")) return true;
      return /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name || "");
    }) || null
  );
}

function imageFileFromList(fileList) {
  const files = Array.from(fileList || []);
  return (
    files.find((file) => {
      if (!file) return false;
      if (String(file.type || "").startsWith("image/")) return true;
      return /\.(png|jpe?g|webp|gif)$/i.test(file.name || "");
    }) || null
  );
}

/**
 * Binds an audio file to a frame and refreshes the affected workbench views.
 * @param {File|null} file Audio file selected by the user.
 * @param {number} [index=selectedFrame] Target frame index.
 * @param {object|null} [group=currentGroup] Target animation group.
 * @returns {Promise<boolean>} Whether the binding was applied.
 */
async function bindFrameAudioFile(file, index = selectedFrame, group = currentGroup) {
  if (!file || !group) return false;
  const frameIndex = clampFrameIndex(index, group);
  await setFrameAudioBinding(file, frameIndex, group);
  markDirty();
  await syncFrameAudioBindingsToGame().catch((error) => {
    status(t("boxSyncFailed", { message: error.message }));
  });
  clearSelectedAttachment();
  if (els.frameAudioFile) els.frameAudioFile.value = "";
  if (group.uiId === currentGroup?.uiId) {
    setSingleFrameSelection(frameIndex, currentGroup);
    syncFrameInputs();
  } else {
    syncFrameAudioInputs();
  }
  renderFilmstrip();
  draw();
  status(t("boundFrameSfx", { name: file.name }));
  return true;
}

/**
 * Removes the selected frame's audio binding and refreshes the workbench.
 * @param {number} [index=selectedFrame] Target frame index.
 * @param {object|null} [group=currentGroup] Target animation group.
 * @returns {Promise<boolean>} Whether a binding was removed.
 */
async function removeFrameAudioFromCard(index = selectedFrame, group = currentGroup) {
  if (!group) return false;
  const frameIndex = clampFrameIndex(index, group);
  if (!frameAudioBinding(frameIndex, group)) return false;
  if (
    !(await requestAppConfirmation(t("frameSfxDeleteConfirm"), {
      title: t("clearFrameSfx"),
      confirmLabel: t("clearFrameSfx"),
      tone: "danger",
    }))
  )
    return false;
  await clearFrameAudioBinding(frameIndex, group);
  markDirty();
  await syncFrameAudioBindingsToGame().catch((error) => {
    status(t("frameSfxDeleteFailed", { message: error.message }));
  });
  syncFrameAudioInputs();
  renderFilmstrip();
  draw();
  status(t("frameSfxDeleted"));
  return true;
}

let filmstripInteraction = null;

function renderFilmstrip() {
  filmstripInteraction?.renderFilmstrip();
}

const attachmentModule = globalThis.XSXBAppAttachments;
if (!attachmentModule) throw new Error("XSXBAppAttachments is required.");
const attachmentController = attachmentModule.createController({
  fetchImpl: globalThis.fetch,
  fileReaderConstructor: globalThis.FileReader,
  imageConstructor: globalThis.Image,
  getActiveProjectId: activeProjectId,
  getConfig: () => config,
  getCurrentGroup: () => currentGroup,
  getLanguage: () => language,
  getAttachmentAssets: () => attachmentAssets,
  setAttachmentAssets: (assets) => {
    attachmentAssets = assets;
  },
  getFrameImageAttachments: () => frameImageAttachments,
  setFrameImageAttachments: (attachments) => {
    frameImageAttachments = attachments;
  },
  getSelectedAttachmentId: () => selectedAttachmentId,
  selectedFrameIndexes,
  getSelectedFrame: () => selectedFrame,
  newLocalId,
  normalizeFrameImageAttachment,
  attachmentLayerOrder,
  frameImageAttachmentKey,
  frameImageAttachmentMetadata,
  nextAboveAttachmentLayerOrder,
  clampFrameIndex,
  pushUndo,
  clearSelectedAttachment,
  loadImageCached,
  selectFrameImageAttachment,
  markDirty,
  renderFilmstrip,
  syncFrameInputs,
  draw,
  status,
  translate: t,
});
const {
  addImagesToCurrentGroupAssets: attachmentAddImagesToCurrentGroupAssets,
  applyAttachmentAsset: attachmentApplyAsset,
  attachmentAssetGroupKey: attachmentGroupKey,
  bindFrameImageAttachmentFile: attachmentBindImageFile,
  collectFrameImageAttachmentsForSave: attachmentCollectForSave,
  persistAttachmentAssets: attachmentPersistAssets,
  readFileAsDataUrl,
  removeFrameImageAttachment: attachmentRemoveImage,
  uploadFrameAttachmentData: uploadFrameAttachmentDataController,
  uploadFrameAttachmentImage: uploadFrameAttachmentImageController,
} = attachmentController;
const persistAttachmentAssets = attachmentPersistAssets;
const applyAttachmentAsset = attachmentApplyAsset;
/**
 * Adds processed images to the active browser-session animation without a server upload.
 * @param {Array<{name?:string,data?:string,image?:HTMLCanvasElement,type?:string}>} items Image sources.
 * @returns {Promise<number>} Added asset count.
 */
async function addBrowserSessionAssets(items) {
  if (!currentGroup)
    throw new Error(language === "zh" ? "请先选择当前动画组。" : "Select an animation group first.");
  const groupKey = attachmentAssetGroupKey(currentGroup);
  const additions = Array.from(items || []).flatMap((item, index) => {
    const path = String(item.data || item.image?.toDataURL?.("image/png") || "");
    if (!path.startsWith("data:image/")) return [];
    return [
      {
        id: newLocalId("asset"),
        name: item.name || `asset_${String(index + 1).padStart(4, "0")}.png`,
        path,
        type: item.type || "image/png",
        width: Number(item.image?.width || 0),
        height: Number(item.image?.height || 0),
        groupKey,
      },
    ];
  });
  attachmentAssets.push(...additions);
  renderFilmstrip();
  markDirty();
  return additions.length;
}

/** @param {object} target Mutable record. @param {object} source Replacement record. @returns {void} */
function replaceRecordContents(target, source) {
  for (const key of Object.keys(target || {})) delete target[key];
  Object.assign(target, source || {});
}

/**
 * Applies a frame-organizer plan to the active in-memory browser animation.
 * @param {Array<object>} items Ordered frame plan.
 * @param {{premiumFeatures?:string[]}} [options] Used Pro features.
 * @returns {Promise<void>}
 */
async function applyBrowserFrameOrganizerPlan(items, options = {}) {
  if (!currentGroup?.frames?.length) throw new Error("No active browser animation.");
  const visualOverrides = overrideStore(currentGroup);
  const playbackOverrides = playbackStore(currentGroup);
  const boxOverrides = boxOverrideStore(currentGroup);
  const result = browserRuntime.reorganizeSessionAnimation(currentGroup, items, {
    frameVisualOverrides: visualOverrides,
    framePlaybackOverrides: playbackOverrides,
    frameBoxOverrides: boxOverrides,
    frameAudioBindings,
    frameImageAttachments,
    premiumFeatures: options.premiumFeatures || [],
  });
  replaceRecordContents(visualOverrides, result.frameVisualOverrides);
  replaceRecordContents(playbackOverrides, result.framePlaybackOverrides);
  replaceRecordContents(boxOverrides, result.frameBoxOverrides);
  frameAudioBindings = result.frameAudioBindings;
  frameImageAttachments = result.frameImageAttachments;
  imageCache.clear();
  imageElements.clear();
  await selectGroup(currentGroup, {
    frameIndex: Math.min(selectedFrame, Math.max(currentGroup.frames.length - 1, 0)),
    preserveView: true,
  });
  markDirty();
}

/**
 * Replaces the current browser animation pixels with processed cutout outputs.
 * @param {Array<object>} outputs Processed frames.
 * @param {{premiumFeatures?:string[]}} [options] Used Pro features.
 * @returns {Promise<void>}
 */
async function applyBrowserCutoutOutputs(outputs, options = {}) {
  if (!currentGroup?.frames?.length) throw new Error("No active browser animation.");
  browserRuntime.replaceSessionAnimationFrames(currentGroup, outputs, options.premiumFeatures || []);
  imageCache.clear();
  imageElements.clear();
  await selectGroup(currentGroup, { frameIndex: selectedFrame, preserveView: true });
  markDirty();
}

const addImagesToCurrentGroupAssets = browserOnlyMode
  ? addBrowserSessionAssets
  : attachmentAddImagesToCurrentGroupAssets;
const bindFrameImageAttachmentFile = attachmentBindImageFile;
const removeFrameImageAttachment = attachmentRemoveImage;
const collectFrameImageAttachmentsForSave = attachmentCollectForSave;
const attachmentAssetGroupKey = attachmentGroupKey;
const uploadFrameAttachmentData = uploadFrameAttachmentDataController;
const uploadFrameAttachmentImage = uploadFrameAttachmentImageController;

const appToolActionsModule = globalThis.XSXBAppToolActions;
if (!appToolActionsModule) throw new Error("XSXBAppToolActions is required.");
appToolActionsController = appToolActionsModule.createController({
  getCurrentGroup: () => currentGroup,
  getSelectedFrame: () => selectedFrame,
  getSelectedFrameIndexes: selectedFrameIndexes,
  getActiveProjectId: activeProjectId,
  getConfig: () => config,
  getLanguage: () => language,
  getFrameMutationPending: () => frameMutationPending,
  setFrameMutationPending: (value) => {
    frameMutationPending = Boolean(value);
  },
  setDirty: (value) => {
    dirty = Boolean(value);
  },
  setSelectedProjectId: (value) => {
    selectedProjectId = value;
  },
  fetchImpl: globalThis.fetch,
  confirm: requestAppConfirmation,
  storage: globalThis.localStorage,
  translate: t,
  status,
  outputCore: globalThis.BatchCutoutOutputCore,
  readMutationResponse,
  resetProjectSession,
  loadConfig,
  resizeCanvas: () => resizeCanvas(),
  selectGroup,
  clearImageCache: () => imageCache.clear(),
  clearImageElements: () => imageElements.clear(),
  setOpaqueRectCache: (value) => {
    opaqueRectCache = value;
  },
  premiumFeatures,
});

const attachmentManipulationModule = globalThis.XSXBAppAttachmentManipulation;
if (!attachmentManipulationModule) throw new Error("XSXBAppAttachmentManipulation is required.");
attachmentManipulationController = attachmentManipulationModule.createController({
  getCurrentGroup: () => currentGroup,
  getImages: () => images,
  getSelectedFrame: () => selectedFrame,
  getView: () => view,
  getDevicePixelRatio: () => devicePixelRatio,
  getHeldAttachmentTransformKeys: () => heldAttachmentTransformKeys,
  getAttachmentWheelUndoTimer: () => attachmentWheelUndoTimer,
  setAttachmentWheelUndoTimer: (value) => {
    attachmentWheelUndoTimer = value;
  },
  getAttachmentWheelUndoLabel: () => attachmentWheelUndoLabel,
  setAttachmentWheelUndoLabel: (value) => {
    attachmentWheelUndoLabel = value;
  },
  attachmentFrameIndex,
  directManipulationAttachment,
  selectedFrameAttachment,
  cachedImageForFrame,
  loadImageCached,
  frameTransform,
  frameScreenRect,
  renderTransformForGroup,
  runtimeBaseScaleForGroup,
  effectiveFlipH,
  normalizeAttachmentTransform,
  rotatePoint,
  rotateVector,
  stagePoint,
  activateFrameAttachmentForEditing,
  pushUndo,
  markDirty,
  syncAdjustmentInputs,
  renderFilmstrip,
  draw,
  windowRef: globalThis.window || globalThis,
});

const playbackInputsModule = globalThis.XSXBAppPlaybackInputs;
if (!playbackInputsModule) throw new Error("XSXBAppPlaybackInputs is required.");
playbackInputsController = playbackInputsModule.createController({
  elements: {
    frameDuration: els.frameDuration,
    frameDisabled: els.frameDisabled,
    fps: els.fps,
    fpsValue: els.fpsValue,
    rootMotionX: els.rootMotionX,
    rootMotionY: els.rootMotionY,
    vfxStartFrame: els.vfxStartFrame,
    vfxEndFrame: els.vfxEndFrame,
  },
  getCurrentGroup: () => currentGroup,
  canEditFramePlayback,
  groupPlaybackDurationSeconds,
  selectedFrameIndexes,
  frameDurationMs,
  groupHasGroupTimeOverride,
  pushUndo,
  clearGroupTimeOverride,
  framePlayback,
  setFramePlayback,
  frameDurationMultiplierFromMs,
  preserveGroupPlaybackDuration,
  syncFrameInputs,
  renderFilmstrip,
  updateWorkbenchHud,
  draw,
  clampFrameIndex,
  usesAttachedPlaybackTiming,
  setSingleFrameSelection,
  setGroupPlaybackData,
  syncGroupPlaybackInputs,
  updateGroupMeta,
  groupPlaybackFps,
  round,
  translate: t,
  confirm: requestAppConfirmation,
  minFrameDurationMs: MIN_FRAME_DURATION_MS,
});

const projectSelectsModule = globalThis.XSXBAppProjectSelects;
if (!projectSelectsModule) throw new Error("XSXBAppProjectSelects is required.");
projectSelectsController = projectSelectsModule.createController({
  elements: {
    projectContext: els.projectContext,
    currentProjectLabel: els.currentProjectLabel,
    projectSelect: els.projectSelect,
    clearProject: els.clearProject,
    deleteProject: els.deleteProject,
    groupSelect: els.groupSelect,
    groupSearch: els.groupSearch,
    groupFilterField: els.groupFilterField,
    chainGroupSelect: els.chainGroupSelect,
  },
  getConfig: () => config,
  setSelectedProjectId: (value) => {
    selectedProjectId = value;
  },
  setSelectedProfileId: (value) => {
    selectedProfileId = value;
  },
  getGroupSearch: () => groupSearch,
  setGroupSearch: (value) => {
    groupSearch = value;
    if (els.groupSearch) els.groupSearch.value = value;
  },
  getCurrentGroup: () => currentGroup,
  storage: globalThis.localStorage,
  escapeHtml,
  projectLabel,
  groupLabel,
  translate: t,
});

const filmstripModule = globalThis.XSXBAppFilmstrip;
if (!filmstripModule) throw new Error("XSXBAppFilmstrip is required.");
const filmstripRendering = filmstripModule.createController({
  filmstrip: els.filmstrip,
  attachmentAssetTrayHost: els.attachmentAssetTrayHost,
  deleteSelectedFramesButton: els.deleteSelectedFrames,
  clearAnimationButton: els.clearAnimation,
  attachmentAssetDragType: ATTACHMENT_ASSET_DRAG_TYPE,
  getAttachmentAssets: () => attachmentAssets,
  getCurrentGroup: () => currentGroup,
  getAttachmentAssetGroupKey: attachmentGroupKey,
  translate: t,
  escapeHtml,
  assetUrl,
  getSelectedFrameCount: selectedFrameCount,
  applyAttachmentAsset: attachmentApplyAsset,
  readFileAsDataUrl,
  addImagesToCurrentGroupAssets: attachmentAddImagesToCurrentGroupAssets,
  status,
  deleteSelectedAnimationFrames,
  clearCurrentAnimation,
});
const { renderAttachmentAssetTray, syncFrameActions } = filmstripRendering;

const filmstripInteractionModule = globalThis.XSXBAppFilmstripInteraction;
if (!filmstripInteractionModule) throw new Error("XSXBAppFilmstripInteraction is required.");
filmstripInteraction = filmstripInteractionModule.createController({
  elements: {
    filmstrip: els.filmstrip,
    chainGroupSelect: els.chainGroupSelect,
    playPause: els.playPause,
  },
  constants: {
    frameDurationStepMs: FRAME_DURATION_STEP_MS,
    layerCardDragType: LAYER_CARD_DRAG_TYPE,
    attachmentAssetDragType: ATTACHMENT_ASSET_DRAG_TYPE,
  },
  state: {
    getCurrentGroup: () => currentGroup,
    getSelectedFrame: () => selectedFrame,
    getSelectedFrames: () => selectedFrames,
    getSelectedAttachmentId: () => selectedAttachmentId,
    setSelectedAttachmentId: (value) => {
      selectedAttachmentId = value;
    },
    setPlaying: (value) => {
      playing = value;
    },
    setPlaybackPrimaryGroup: (value) => {
      playbackPrimaryGroup = value;
    },
    getLayerCardDrag: () => layerCardDrag,
    setLayerCardDrag: (value) => {
      layerCardDrag = value;
    },
    getAttachmentAssets: () => attachmentAssets,
  },
  handlers: {
    renderAttachmentAssetTray,
    syncFrameActions,
    getPlaybackChainGroup: playbackChainGroup,
    clearSelectedAttachment,
    clampFrameIndex,
    setSingleFrameSelection,
    draw,
    selectGroup,
    selectFilmstripFrame,
    selectFrameImageAttachment,
    removeFrameImageAttachment,
    applyAttachmentAsset,
    bindFrameImageAttachmentFile,
    bindFrameAudioFile,
    removeFrameAudioFromCard,
    adjustFrameDurationMs,
    imageFileFromList,
    audioFileFromList,
    overrideStore,
    tuningFrameKey,
    frameAudioBinding,
    sourceFrameIndex,
    canEditFramePlayback,
    usesAttachedPlaybackTiming,
    frameDurationMsLabel,
    framePlayback,
    isReferenceFrame,
    frameLayerStackItems,
    layerCardInfosForFrame,
    layerCardInfoForAttachment,
    layerCardInfoForMain,
    layerCardDomKey,
    layerCardKey,
    movedLayerCardOrder,
    applyFrameLayerCardOrder,
    pushUndo,
    markDirty,
    attachmentLayerOrder,
    status,
  },
  utils: { translate: t, escapeHtml, assetUrl },
  documentRef: globalThis.document,
  requestAnimationFrameRef: globalThis.requestAnimationFrame?.bind(globalThis),
});

const canvasRendererModule = globalThis.XSXBAppCanvasRenderer;
if (!canvasRendererModule) throw new Error("XSXBAppCanvasRenderer is required.");
const canvasRenderState = {};
Object.defineProperties(canvasRenderState, {
  config: { get: () => config },
  view: { get: () => view },
  currentGroup: { get: () => currentGroup },
  images: { get: () => images },
  selectedFrame: { get: () => selectedFrame },
  selectedFrames: { get: () => selectedFrames },
  selectedAttachmentId: { get: () => selectedAttachmentId },
  previewOwnerGroup: { get: () => previewOwnerGroup },
  previewOwnerImages: { get: () => previewOwnerImages },
  coordinateOwnerGroup: { get: () => coordinateOwnerGroup },
  coordinateOwnerImages: { get: () => coordinateOwnerImages },
  attachedLayerImageSets: { get: () => attachedLayerImageSets },
  chainImages: { get: () => chainImages },
  ghost: { get: () => ghost },
  pointerStagePoint: { get: () => pointerStagePoint },
  language: { get: () => language },
  playing: { get: () => playing },
  showBoxes: { get: () => showBoxes },
  selectedBox: { get: () => selectedBox },
  selectedBoxes: { get: () => selectedBoxes },
  referenceFrame: { get: () => referenceFrame },
  referenceFrameHiddenByKey: { get: () => referenceFrameHiddenByKey },
});
canvasRenderer = canvasRendererModule.createController({
  context: ctx,
  elements: els,
  getState: () => canvasRenderState,
  getDevicePixelRatio: () => devicePixelRatio,
  attachedLayerGroups,
  attachedVfxPlaybackWindow,
  boxDrawOrder: BOX_DRAW_ORDER,
  boxScreenRect,
  canEditBoxes,
  clampInteger,
  cloneVector,
  coordinateGridStep,
  coordinateOrigin,
  coordinateScreenScale,
  coordinateToScreen,
  drawableFrameAttachments,
  editableBoxHandleRects,
  floorReferenceLabel,
  floorTopReferenceOffset,
  frameImageAttachmentScreenRect,
  framePlayback,
  frameTransform,
  groupOriginScreen,
  isReferenceFrame,
  loadImageCached,
  nearlyEqual,
  nextPlayableFrameInGroup,
  normalizeAttachmentTransform,
  opaqueRectForImage,
  playbackChainGroup,
  renderTransformForGroup,
  rawGroupPlaybackFps,
  round,
  runtimeBaseScaleForGroup,
  screenToCoordinate,
  selectedFrameAttachment,
  selectedFrameIndexes,
  t,
  targetHeightAnimationAnchorX,
  targetHeightAnimationAnchorY,
  usesRuntimeFootAnchor,
  usesSceneTopLeftAnchor,
  valueStore,
});

const stageViewModule = globalThis.XSXBStageView;
if (!stageViewModule) throw new Error("XSXBStageView is required.");
const stageViewController = stageViewModule.createController({
  stage: els.stage,
  stageZoom: els.stageZoom,
  stageZoomValue: els.stageZoomValue,
  stageZoomFit: els.stageZoomFit,
  stageZoomActual: els.stageZoomActual,
  getView: () => view,
  setView: (value) => {
    view = value;
  },
  getStageViewMode: () => stageViewMode,
  setStageViewMode: (value) => {
    stageViewMode = value;
  },
  getCurrentGroup: () => currentGroup,
  getImages: () => images,
  currentFrameRect,
  draw,
  getDevicePixelRatio: () => devicePixelRatio,
});
const { centerStageContent, fitView, setStageZoom, zoomViewAt, resizeCanvas } = stageViewController;

function trackAttachmentTransformKey(event, pressed) {
  const key = String(event.key || "").toLowerCase();
  if (key !== "r" && key !== "z") return false;
  if (pressed && isTypingTarget(event)) return false;
  if (pressed) heldAttachmentTransformKeys.add(key);
  else heldAttachmentTransformKeys.delete(key);
  return true;
}

const keyboardModule = globalThis.XSXBAppKeyboard;
if (!keyboardModule) throw new Error("XSXBAppKeyboard is required.");
const keyboardController = keyboardModule.createController({
  windowRef: globalThis,
  documentRef: document,
  isTypingTarget,
  isNumberInputTarget,
  save,
  undo,
  redo,
  copyFrameImageAttachments,
  pasteFrameImageAttachments,
  trackAttachmentTransformKey,
  getReferenceFrame: () => referenceFrame,
  getReferenceFrameHiddenByKey: () => referenceFrameHiddenByKey,
  setReferenceFrameHiddenByKey: (value) => {
    referenceFrameHiddenByKey = Boolean(value);
  },
  getCurrentGroup: () => currentGroup,
  getSelectedFrame: () => selectedFrame,
  setSelectedFrame: (value) => {
    selectedFrame = value;
  },
  setSelectedFrames: (value) => {
    selectedFrames = value;
  },
  setSelectionAnchorFrame: (value) => {
    selectionAnchorFrame = value;
  },
  syncFrameInputs,
  renderFilmstrip,
  draw,
  selectFilmstripFrame,
  fitView,
  centerStageContent,
  playPauseElement: els.playPause,
  clearHeldAttachmentTransformKeys: () => heldAttachmentTransformKeys.clear(),
  getCurrentWorkbenchRoute: currentWorkbenchRoute,
  syncWorkbenchRoute,
  applyWorkbenchRoute,
  status,
  translate: t,
});

function updateSelectedFromInputs(transform = transformFromAdjustmentInputs()) {
  const attachment = selectedFrameAttachment();
  if (attachment) {
    attachment.transform = normalizeAttachmentTransform(transform);
    markDirty();
    renderFilmstrip();
    draw();
    return;
  }
  if (!canEditFrameTransform()) return;
  for (const frameIndex of selectedFrameIndexes()) {
    setFrameTransform(frameIndex, transform);
  }
  renderFilmstrip();
  draw();
}

function updateCharacterFromInputs(transform = transformFromAdjustmentInputs()) {
  if (!canEditCharacterTransform()) return;
  const store = valueStore();
  if (!currentGroup?.characterScale) return;
  const scale = Number(transform.scale);
  store[currentGroup.characterScale] = scale;
  if (currentGroup.characterScaleVector) {
    const scaleVector = scaleVectorFromTransform(transform);
    if (nearlyEqual(scaleVector.x, scale) && nearlyEqual(scaleVector.y, scale)) {
      delete store[currentGroup.characterScaleVector];
    } else {
      store[currentGroup.characterScaleVector] = scaleVector;
    }
  }
  if (currentGroup.characterOffset) store[currentGroup.characterOffset] = cloneVector(transform.offset);
  if (currentGroup.characterRotation) store[currentGroup.characterRotation] = Number(transform.rotation || 0);
  markDirty();
  syncFrameInputs();
  renderFilmstrip();
  updateGroupMeta();
  draw();
}

function updateBaseFromInputs(transform = transformFromAdjustmentInputs()) {
  if (!canEditGroupTransform()) return;
  const store = valueStore();
  const previousBase =
    baseEditSnapshot?.groupUiId === currentGroup?.uiId ? baseEditSnapshot.base : baseTransform();
  const nextBase = transform;
  const scaleRatio = previousBase.scale !== 0 ? nextBase.scale / previousBase.scale : 1;
  const previousScaleX = Number(previousBase.scaleX ?? previousBase.scale);
  const previousScaleY = Number(previousBase.scaleY ?? previousBase.scale);
  const scaleXRatio = previousScaleX !== 0 ? Number(nextBase.scaleX ?? nextBase.scale) / previousScaleX : 1;
  const scaleYRatio = previousScaleY !== 0 ? Number(nextBase.scaleY ?? nextBase.scale) / previousScaleY : 1;
  const offsetDelta = {
    x: nextBase.offset.x - previousBase.offset.x,
    y: nextBase.offset.y - previousBase.offset.y,
  };
  const rotationDelta = Number(nextBase.rotation || 0) - Number(previousBase.rotation || 0);
  const storeOverrides = overrideStore();
  const sourceOverrides =
    baseEditSnapshot?.groupUiId === currentGroup?.uiId ? baseEditSnapshot.overrides : storeOverrides;
  const animationName = tuningAnimationName(currentGroup);
  if (sourceOverrides !== storeOverrides) {
    for (const key of Object.keys(storeOverrides)) {
      if (key.startsWith(`${animationName}:`)) delete storeOverrides[key];
    }
  }
  for (const key of Object.keys(sourceOverrides)) {
    if (!key.startsWith(`${animationName}:`)) continue;
    const override = structuredClone(sourceOverrides[key]);
    if (!override) continue;
    if (Number.isFinite(Number(override.visual_size))) {
      override.visual_size = Number(override.visual_size) * scaleRatio;
    }
    const overrideScale = cloneScaleVector(
      override.visual_scale,
      Number(override.visual_size || nextBase.scale),
    );
    override.visual_scale = {
      x: overrideScale.x * scaleXRatio,
      y: overrideScale.y * scaleYRatio,
    };
    if (
      nearlyEqual(override.visual_scale.x, override.visual_size) &&
      nearlyEqual(override.visual_scale.y, override.visual_size)
    ) {
      delete override.visual_scale;
    }
    if (override.offset) {
      override.offset = {
        x: Number(override.offset.x || 0) + offsetDelta.x,
        y: Number(override.offset.y || 0) + offsetDelta.y,
      };
    }
    override.rotation = Number(override.rotation ?? previousBase.rotation ?? 0) + rotationDelta;
    storeOverrides[key] = override;
  }
  store[currentGroup.scale] = nextBase.scale;
  if (currentGroup.scaleVector)
    store[currentGroup.scaleVector] = { x: Number(nextBase.scaleX), y: Number(nextBase.scaleY) };
  store[currentGroup.offset] = nextBase.offset;
  if (currentGroup.rotation) store[currentGroup.rotation] = Number(nextBase.rotation || 0);
  markDirty();
  syncFrameInputs();
  renderFilmstrip();
  updateGroupMeta();
  draw();
}

function updateAdjustmentFromInputs() {
  const transform = transformFromAdjustmentInputs();
  if (adjustmentMode === "character") {
    updateCharacterFromInputs(transform);
  } else if (adjustmentMode === "frame") {
    updateSelectedFromInputs(transform);
  } else {
    updateBaseFromInputs(transform);
  }
}

async function save() {
  return saveController.save();
}

/** @returns {object} Standard player tuning values. */
function collectTuningValues() {
  return saveController.collectTuningValues();
}

const appEventsModule = globalThis.XSXBAppEvents;
if (!appEventsModule) throw new Error("XSXBAppEvents is required.");
const appEvents = appEventsModule.createController({
  elements: els,
  state: eventState,
  constants: { ADJUSTMENT_MODE_KEY },
  documentRef: globalThis.document,
  windowRef: globalThis,
  storage: globalThis.localStorage,
  getDevicePixelRatio: () => devicePixelRatio,
  structuredCloneImpl: globalThis.structuredClone,
  handlers: {
    activateFrameAttachmentForEditing,
    activateProject,
    applyCanvasColor,
    applyGroupTimeFromInput,
    applyLanguage,
    applySelectedAttachmentWheel,
    applyUiTheme,
    adjustmentNumberInputs,
    attachmentFrameIndex,
    attachmentOffsetDeltaFromClientDelta,
    bindFrameAudioFile,
    boxOffsetDeltaFromScreenDelta,
    boxResizeDeltaFromScreenDelta,
    canEditBox,
    canEditFramePlayback,
    canEditFrameTransform,
    clampFrameIndex,
    centerStageContent,
    clearActiveProject,
    clearBoxOverride,
    clearFrameAudioBinding,
    clearSelectedAttachment,
    cloneState,
    cloneVector,
    collisionOffsetYForHeight,
    createBoxEditSnapshot,
    deleteActiveProject,
    deleteBoxOnFrame,
    draw,
    baseTransform,
    firstEditableSelectedBox,
    firstPlayableFrame,
    fitView,
    frameAudioBinding,
    frameBox,
    framePlayback,
    groupHasGroupTimeOverride,
    groupOwnsFrameKey,
    hitTestBoxes,
    hitTestDirectManipulationAttachment,
    installTunerUpdate,
    isCollisionBox,
    keyboardController,
    loadChainImages,
    markDirty,
    normalizeAdjustmentMode,
    normalizeAttachmentTransform,
    normalizeColor,
    normalizeTheme,
    playFrameAudio,
    playbackChainGroup,
    playbackStore,
    pushUndo,
    overrideStore,
    refreshActiveProject,
    redo,
    renderFilmstrip,
    renderGroupSelect,
    removeFrameAudioFromCard,
    save,
    saveBoxViewPrefs,
    schedulePlaybackAnimation,
    selectGroup,
    selectedFrameAttachment,
    selectedFrameIndexes,
    setBoxOverride,
    setFrameAudioBinding,
    setFrameTransform,
    setReferenceFrameEnabled,
    setSingleFrameSelection,
    setStageZoom,
    status,
    stepAdjustmentInput,
    stepOffsetByArrowKey,
    stagePoint,
    syncAdjustmentInputs,
    syncAdjustmentModeInputs,
    syncBoxInputs,
    syncFrameAudioBindingsToGame,
    syncFrameAudioInputs,
    syncFrameInputs,
    syncSceneInputs,
    tuningFrameKey,
    t,
    undo,
    updateAdjustmentFromInputs,
    updateCoordHud,
    updateGroupMeta,
    updateGroupPlaybackFromInputs,
    updateHistoryControls,
    updateSceneScaleFromInput,
    updateSelectedBoxFromInputs,
    updateSelectedFromInputs,
    updateSelectedPlaybackFromInputs,
    zoomViewAt,
    rotateVector,
  },
});
appEvents.bind();

els.stage.addEventListener("lostpointercapture", () => {
  drag = null;
  els.stage.classList.remove("dragging");
  updateCoordHud();
});

els.stage.addEventListener("pointerleave", () => {
  if (drag) return;
  pointerStagePoint = null;
  updateCoordHud();
});

els.stage.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    pointerStagePoint = stagePoint(event);
    if (applySelectedAttachmentWheel(event)) return;
    zoomViewAt(event);
  },
  { passive: false },
);

keyboardController.bind();

window.addEventListener("resize", resizeCanvas);
window.addEventListener("beforeunload", (event) => {
  if (!dirty && !frameOrganizer?.hasUnsavedChanges?.() && !batchCutout?.hasUnsavedChanges?.()) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("popstate", () => {
  const urlState = new URLSearchParams(window.location.search);
  const requestedProject = urlState.get("project") || "";
  const requestedGroup = urlState.get("group") || "";
  const requestedFrame = Math.max(0, Number.parseInt(urlState.get("frame") || "0", 10) || 0);
  const restore = async () => {
    selectedProfileId = "all";
    if (requestedProject && requestedProject !== activeProjectId()) {
      selectedProjectId = requestedProject;
      await loadConfig();
      await applyWorkbenchRoute();
      return;
    }
    const group = config?.groups?.find((entry) => entry.uiId === requestedGroup);
    if (group) await selectGroup(group, { frameIndex: requestedFrame, history: false });
    await applyWorkbenchRoute();
  };
  restore().catch((error) => status(t("loadFailed", { message: error.message })));
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") schedulePlaybackAnimation();
});
batchCutout =
  window.BatchCutout?.createController({
    getLanguage: () => language,
    getCurrentAnimation: () =>
      currentGroup?.frames?.length
        ? {
            name: groupLabel(currentGroup),
            frames: currentGroup.frames,
            images,
            loop: currentGroup.loop === true || currentGroup.loopMode === "loop",
          }
        : null,
    applyToCurrentAnimation: browserOnlyMode
      ? applyBrowserCutoutOutputs
      : applyCutoutOutputsToCurrentAnimation,
    premiumFeatures,
    ensurePremiumActivated,
    onOpen: () => {
      const currentRoute = currentWorkbenchRoute();
      cutoutReturnTool = currentRoute === "organizer" || currentRoute === "import" ? currentRoute : "";
      syncWorkbenchRoute("cutout", { push: true });
    },
    onClose: () => {
      syncWorkbenchRoute(cutoutReturnTool);
      cutoutReturnTool = "";
    },
    onStatus: (message) => status(message),
  }) || null;
frameOrganizer =
  window.FrameOrganizer?.createController({
    browserExportOnly: browserOnlyMode,
    getLanguage: () => language,
    getImportContext: () => ({
      activeProject: config?.activeProject || null,
      profiles: config?.profiles || [],
    }),
    getCurrentAnimation: () =>
      currentGroup?.frames?.length && currentGroup.profileId && currentGroup.animationId
        ? {
            name: groupLabel(currentGroup),
            profileId: currentGroup.profileId,
            animationId: currentGroup.animationId,
            profileLabel: currentGroup.profileLabel,
            animationType: currentGroup.type,
            fps: currentGroup.speed,
            anchorMode: currentGroup.anchorMode,
            frames: currentGroup.frames,
            images,
          }
        : null,
    applyPlan: browserOnlyMode ? applyBrowserFrameOrganizerPlan : applyFrameOrganizerPlan,
    createAnimation: browserOnlyMode ? exportBrowserAnimation : createAnimationFromOrganizer,
    createSessionAnimation: browserOnlyMode ? createBrowserSessionAnimation : undefined,
    exportAnimation: exportBrowserAnimation,
    addAssets: addImagesToCurrentGroupAssets,
    editCutout: (workset) => {
      if (!batchCutout?.openWorkset) throw new Error("Batch cutout is unavailable.");
      return batchCutout.openWorkset(workset);
    },
    premiumFeatures,
    ensurePremiumActivated,
    onOpen: (mode) => syncWorkbenchRoute(mode === "import" ? "import" : "organizer", { push: true }),
    onClose: () => syncWorkbenchRoute(""),
    onStatus: (message) => status(message),
  }) || null;
const workbenchExportModule = globalThis.XSXBWorkbenchExport;
if (browserOnlyMode && !workbenchExportModule) throw new Error("XSXBWorkbenchExport is required.");
const workbenchExportController = browserOnlyMode
  ? workbenchExportModule.createController({
      browserRuntime,
      premiumFeatures,
      ensureActivated: ensurePremiumActivated,
      getCurrentGroup: () => currentGroup,
      getAttachmentAssets: () => attachmentAssets,
      getTuningSnapshot: (group) =>
        browserRuntime.createSessionExportSnapshot(group, {
          values: tuningValues.collectTuningValues(),
          frameAudioBindings,
          frameImageAttachments: attachmentCollectForSave(),
          frameVisualOverrides: overrideStore(group),
          framePlaybackOverrides: playbackStore(group),
          frameBoxOverrides: boxOverrideStore(group),
        }),
      status,
      translate: t,
    })
  : null;
if (els.exportWorkbench) {
  els.exportWorkbench.hidden = !browserOnlyMode;
  els.exportWorkbench.addEventListener("click", () => {
    void workbenchExportController
      ?.exportCurrentAnimation()
      .catch((error) => status(t("saveFailed", { message: error.message })));
  });
}
els.organizerNewOpen?.addEventListener("click", () => {
  void frameOrganizer?.openImport().catch((error) => status(t("loadFailed", { message: error.message })));
});
els.homeHubContinue?.addEventListener("click", () => {
  homeHubDismissed = true;
  renderHomeHub();
  els.stage.focus();
});
els.homeCopyProjectPath?.addEventListener("click", async () => {
  const projectPath = els.homeProjectPath?.textContent || "";
  if (!projectPath || projectPath === "—") return;
  try {
    await navigator.clipboard.writeText(projectPath);
    status(t("copied"));
  } catch (_error) {
    status(t("copyFailed"));
  }
});
for (const button of els.homeToolButtons) {
  button.addEventListener("click", () => {
    const tool = button.dataset.homeTool;
    if (tool === "import") {
      frameOrganizer?.openImport().catch((error) => status(t("loadFailed", { message: error.message })));
    } else if (tool === "workspace") {
      syncWorkbenchRoute("", { push: true });
      els.stage.focus();
    } else if (tool === "cutout") {
      batchCutout?.open();
    }
  });
}
applyUiTheme();
applyCanvasColor();
applyLanguage();
loadConfig()
  .then(async () => {
    resizeCanvas();
    if (!browserOnlyMode) checkTunerUpdate();
    await applyWorkbenchRoute();
  })
  .catch((error) => status(t("loadFailed", { message: error.message })));
