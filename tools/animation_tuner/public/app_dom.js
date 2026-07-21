(function attachXsxbAppDom(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppDom = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Collects the DOM elements owned by the main frame-tuning workbench.
   *
   * Keeping DOM lookup in one small module gives the application controller a
   * stable dependency boundary while preserving the existing element names.
   * @param {Document} [documentRef] Document used for DOM lookup.
   * @returns {Record<string, Element|Element[]>} Named workbench elements.
   * @throws {TypeError} When the provided value cannot query the DOM.
   */
  function createElements(documentRef = root.document) {
    if (
      !documentRef ||
      typeof documentRef.querySelector !== "function" ||
      typeof documentRef.querySelectorAll !== "function"
    ) {
      throw new TypeError("XSXB App DOM requires a document-like query interface.");
    }

    return {
      updatePanel: documentRef.querySelector("#updatePanel"),
      updateVersion: documentRef.querySelector("#updateVersion"),
      updateMessage: documentRef.querySelector("#updateMessage"),
      updateButton: documentRef.querySelector("#updateButton"),
      projectSelect: documentRef.querySelector("#projectSelect"),
      importAnimationOpen: documentRef.querySelector("#importAnimationOpen"),
      refreshProject: documentRef.querySelector("#refreshProject"),
      clearProject: documentRef.querySelector("#clearProject"),
      deleteProject: documentRef.querySelector("#deleteProject"),
      appConfirmPanel: documentRef.querySelector("#appConfirmPanel"),
      appConfirmCard: documentRef.querySelector("#appConfirmCard"),
      appConfirmTitle: documentRef.querySelector("#appConfirmTitle"),
      appConfirmMessage: documentRef.querySelector("#appConfirmMessage"),
      appConfirmDetails: documentRef.querySelector("#appConfirmDetails"),
      appConfirmCancel: documentRef.querySelector("#appConfirmCancel"),
      appConfirmAccept: documentRef.querySelector("#appConfirmAccept"),
      languageSelect: documentRef.querySelector("#languageSelect"),
      languageButtons: Array.from(documentRef.querySelectorAll("[data-language]")),
      themeButtons: Array.from(documentRef.querySelectorAll("[data-theme]")),
      canvasColor: documentRef.querySelector("#canvasColor"),
      profileSelect: documentRef.querySelector("#profileSelect"),
      groupSelect: documentRef.querySelector("#groupSelect"),
      groupSearch: documentRef.querySelector("#groupSearch"),
      sceneSelect: documentRef.querySelector("#sceneSelect"),
      sceneScale: documentRef.querySelector("#sceneScale"),
      characterBaseScale: documentRef.querySelector("#characterBaseScale"),
      characterBaseSource: documentRef.querySelector("#characterBaseSource"),
      canvasTitle: documentRef.querySelector("#canvasTitle"),
      selectionHud: documentRef.querySelector("#selectionHud"),
      coordHud: documentRef.querySelector("#coordHud"),
      homeHub: documentRef.querySelector("#homeHub"),
      homeHubOpen: documentRef.querySelector("#homeHubOpen"),
      homeHubContinue: documentRef.querySelector("#homeHubContinue"),
      homeAnimationCount: documentRef.querySelector("#homeAnimationCount"),
      homeFrameCount: documentRef.querySelector("#homeFrameCount"),
      homeProfileCount: documentRef.querySelector("#homeProfileCount"),
      homeLastEdited: documentRef.querySelector("#homeLastEdited"),
      homeRecentProject: documentRef.querySelector("#homeRecentProject"),
      homeRecentAnimation: documentRef.querySelector("#homeRecentAnimation"),
      homeRecentTool: documentRef.querySelector("#homeRecentTool"),
      homeProjectPath: documentRef.querySelector("#homeProjectPath"),
      homeCopyProjectPath: documentRef.querySelector("#homeCopyProjectPath"),
      homeToolButtons: Array.from(documentRef.querySelectorAll("[data-home-tool]")),
      stage: documentRef.querySelector("#stage"),
      filmstrip: documentRef.querySelector("#filmstrip"),
      baseScale: documentRef.querySelector("#baseScale"),
      baseScaleX: documentRef.querySelector("#baseScaleX"),
      baseScaleY: documentRef.querySelector("#baseScaleY"),
      baseX: documentRef.querySelector("#baseX"),
      baseY: documentRef.querySelector("#baseY"),
      baseRotation: documentRef.querySelector("#baseRotation"),
      adjustCharacter: documentRef.querySelector("#adjustCharacter"),
      adjustGroup: documentRef.querySelector("#adjustGroup"),
      adjustFrame: documentRef.querySelector("#adjustFrame"),
      frameScale: documentRef.querySelector("#frameScale"),
      frameScaleX: documentRef.querySelector("#frameScaleX"),
      frameScaleY: documentRef.querySelector("#frameScaleY"),
      frameX: documentRef.querySelector("#frameX"),
      frameY: documentRef.querySelector("#frameY"),
      frameRotation: documentRef.querySelector("#frameRotation"),
      frameDuration: documentRef.querySelector("#frameDuration"),
      groupTimeField: documentRef.querySelector("#groupTimeField"),
      groupTimeMs: documentRef.querySelector("#groupTimeMs"),
      frameAudioFile: documentRef.querySelector("#frameAudioFile"),
      frameAudioDrop: documentRef.querySelector("#frameAudioDrop"),
      frameAudioName: documentRef.querySelector("#frameAudioName"),
      clearFrameAudio: documentRef.querySelector("#clearFrameAudio"),
      frameReference: documentRef.querySelector("#frameReference"),
      frameDisabled: documentRef.querySelector("#frameDisabled"),
      showBoxes: documentRef.querySelector("#showBoxes"),
      boxOnlyMode: documentRef.querySelector("#boxOnlyMode"),
      boxChoices: documentRef.querySelector("#boxChoices"),
      boxChoiceInputs: Array.from(documentRef.querySelectorAll("[data-box-choice]")),
      boxEnabled: documentRef.querySelector("#boxEnabled"),
      boxX: documentRef.querySelector("#boxX"),
      boxY: documentRef.querySelector("#boxY"),
      boxW: documentRef.querySelector("#boxW"),
      boxH: documentRef.querySelector("#boxH"),
      boxRotation: documentRef.querySelector("#boxRotation"),
      deleteBox: documentRef.querySelector("#deleteBox"),
      clearBox: documentRef.querySelector("#clearBox"),
      fps: documentRef.querySelector("#fps"),
      fpsValue: documentRef.querySelector("#fpsValue"),
      vfxWindowControls: documentRef.querySelector("#vfxWindowControls"),
      vfxStartFrame: documentRef.querySelector("#vfxStartFrame"),
      vfxEndFrame: documentRef.querySelector("#vfxEndFrame"),
      rootMotionX: documentRef.querySelector("#rootMotionX"),
      rootMotionY: documentRef.querySelector("#rootMotionY"),
      chainGroupSelect: documentRef.querySelector("#chainGroupSelect"),
      playPause: documentRef.querySelector("#playPause"),
      ghostToggle: documentRef.querySelector("#ghostToggle"),
      stageZoom: documentRef.querySelector("#stageZoom"),
      stageZoomValue: documentRef.querySelector("#stageZoomValue"),
      stageZoomOut: documentRef.querySelector("#stageZoomOut"),
      stageZoomIn: documentRef.querySelector("#stageZoomIn"),
      stageZoomFit: documentRef.querySelector("#stageZoomFit"),
      stageZoomActual: documentRef.querySelector("#stageZoomActual"),
      applyBaseToFrame: documentRef.querySelector("#applyBaseToFrame"),
      undo: documentRef.querySelector("#undo"),
      undoTop: documentRef.querySelector("#undoTop"),
      redoTop: documentRef.querySelector("#redoTop"),
      clearFrame: documentRef.querySelector("#clearFrame"),
      clearGroup: documentRef.querySelector("#clearGroup"),
      save: documentRef.querySelector("#save"),
      saveState: documentRef.querySelector("#saveState"),
      status: documentRef.querySelector("#status"),
      resetView: documentRef.querySelector("#resetView"),
    };
  }

  return { createElements };
});
