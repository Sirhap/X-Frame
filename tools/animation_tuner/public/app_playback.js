(function attachXsxbAppPlayback(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppPlayback = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /** Counts frames that participate in playback. */
  function playableFrameCount(group, getFramePlayback = () => ({ disabled: false })) {
    const frames = Array.isArray(group?.frames) ? group.frames : [];
    return frames.reduce(
      (count, _frame, index) => count + (getFramePlayback(index, group)?.disabled ? 0 : 1),
      0,
    );
  }

  /** Reports whether playback would produce a visible frame transition. */
  function canPlayGroup(group, getFramePlayback = () => ({ disabled: false })) {
    return playableFrameCount(group, getFramePlayback) > 1;
  }

  /**
   * Creates the animation playback controller used by the main canvas.
   * @param {{
   *   getPlaying?:()=>boolean,
   *   getPlaybackAnimationFrame?:()=>number,
   *   setPlaybackAnimationFrame?:(value:number)=>void,
   *   getCurrentGroup?:()=>object|null,
   *   getImages?:()=>object[],
   *   getPlaybackSwitching?:()=>boolean,
   *   getLastPlay?:()=>number,
   *   setLastPlay?:(value:number)=>void,
   *   getSelectedFrame?:()=>number,
   *   getPlaybackPrimaryGroup?:()=>object|null,
   *   getPlaybackSecondaryGroup?:()=>object|null,
   *   setPlaybackSwitching?:(value:boolean)=>void,
   *   getFramePlayback?:(index:number,group:object)=>{disabled?:boolean},
   *   getGroupPlaybackFps?:(group:object)=>number,
   *   getEffectiveFrameDurationMultiplier?:(index:number,group:object)=>number,
   *   getPlaybackChainGroup?:()=>object|null,
   *   chainGroupSelect?:{value:string}|null,
   *   setSingleFrameSelection?:(index:number,group:object)=>void,
   *   syncFilmstripPlayhead?:()=>void,
   *   draw?:()=>void,
   *   selectGroup?:(group:object,options:object)=>Promise<void>,
   *   playFrameAudio?:(index:number,group:object)=>void,
   *   playbackNeedsContinuousDraw?:()=>boolean,
   *   onError?:(error:unknown)=>void,
   *   documentRef?:Document,
   *   requestAnimationFrameRef?:(callback:(time:number)=>void)=>number,
   * }} dependencies Controller dependencies.
   * @returns {{
   *   animate:(time:number)=>void,
   *   schedulePlaybackAnimation:()=>void,
   *   firstPlayableFrame:(group:object)=>number,
   *   nextPlayableFrameInGroup:(group:object,index:number)=>{index:number,wrapped:boolean},
   *   playbackChainGroup:()=>object|null,
   *   switchPlaybackGroup:(group:object,frameIndex:number)=>Promise<boolean>,
   *   advancePlayback:()=>void,
   * }} Playback operations.
   */
  function createController(dependencies = {}) {
    const {
      getPlaying = () => false,
      getPlaybackAnimationFrame = () => 0,
      setPlaybackAnimationFrame = () => {},
      getCurrentGroup = () => null,
      getImages = () => [],
      getPlaybackSwitching = () => false,
      getLastPlay = () => 0,
      setLastPlay = () => {},
      getSelectedFrame = () => 0,
      getPlaybackPrimaryGroup = () => null,
      getPlaybackSecondaryGroup = () => null,
      setPlaybackSwitching = () => {},
      getFramePlayback = () => ({ disabled: false }),
      getGroupPlaybackFps = () => 1,
      getEffectiveFrameDurationMultiplier = () => 1,
      getPlaybackChainGroup = () => null,
      chainGroupSelect = null,
      setSingleFrameSelection = () => {},
      syncFilmstripPlayhead = () => {},
      draw = () => {},
      selectGroup = async () => {},
      playFrameAudio = () => {},
      playbackNeedsContinuousDraw = () => false,
      onError = () => {},
      documentRef = root.document,
      requestAnimationFrameRef = root.requestAnimationFrame?.bind(root),
    } = dependencies;

    /**
     * Finds the first frame that is not disabled for playback.
     * @param {object|null|undefined} group Animation group.
     * @returns {number} First playable frame index, or zero.
     */
    function firstPlayableFrame(group) {
      const frames = Array.isArray(group?.frames) ? group.frames : [];
      for (let index = 0; index < frames.length; index += 1) {
        if (!getFramePlayback(index, group).disabled) return index;
      }
      return 0;
    }

    /**
     * Finds the next enabled frame and reports whether the sequence wrapped.
     * @param {object|null|undefined} group Animation group.
     * @param {number} index Current frame index.
     * @returns {{index:number,wrapped:boolean}} Next frame and wrap state.
     */
    function nextPlayableFrameInGroup(group, index) {
      const frames = Array.isArray(group?.frames) ? group.frames : [];
      if (!frames.length) return { index: 0, wrapped: true };
      const currentIndex = Number.isInteger(index) ? Math.max(0, Math.min(index, frames.length - 1)) : 0;
      for (let step = 1; step <= frames.length; step += 1) {
        const candidate = (currentIndex + step) % frames.length;
        if (!getFramePlayback(candidate, group).disabled) {
          return { index: candidate, wrapped: candidate <= currentIndex };
        }
      }
      return { index: currentIndex, wrapped: true };
    }

    /**
     * Returns the configured secondary playback group from the current UI.
     * @returns {object|null} Selected chain group.
     */
    function playbackChainGroup() {
      return getPlaybackChainGroup() || null;
    }

    /**
     * Switches the active group while keeping the animation loop alive.
     * @param {object|null|undefined} group Target group.
     * @param {number} frameIndex Target frame index.
     * @returns {Promise<boolean>} Whether the switch completed.
     */
    async function switchPlaybackGroup(group, frameIndex) {
      if (!group) return false;
      setPlaybackSwitching(true);
      try {
        await selectGroup(group, { frameIndex, preserveView: true, stopPlayback: false });
        playFrameAudio(frameIndex, group);
        return true;
      } catch (error) {
        onError(error);
        return false;
      } finally {
        setPlaybackSwitching(false);
      }
    }

    /**
     * Advances the primary or chained playback sequence by one playable frame.
     * @returns {void}
     */
    function advancePlayback() {
      const currentGroup = getCurrentGroup();
      if (!currentGroup) return;
      const primary = getPlaybackPrimaryGroup() || currentGroup;
      const secondary = getPlaybackSecondaryGroup();
      const selectedFrame = getSelectedFrame();
      const next = nextPlayableFrameInGroup(currentGroup, selectedFrame);
      if (!secondary || secondary.uiId === primary.uiId || !next.wrapped) {
        setSingleFrameSelection(next.index, currentGroup);
        syncFilmstripPlayhead();
        draw();
        playFrameAudio(next.index, currentGroup);
        return;
      }
      const nextGroup = currentGroup.uiId === primary.uiId ? secondary : primary;
      if (!chainGroupSelect) {
        void switchPlaybackGroup(nextGroup, firstPlayableFrame(nextGroup));
        return;
      }
      if (nextGroup.uiId === secondary.uiId) {
        chainGroupSelect.value = primary.uiId;
      } else {
        chainGroupSelect.value = secondary.uiId;
      }
      void switchPlaybackGroup(nextGroup, firstPlayableFrame(nextGroup));
    }

    /**
     * Runs one requestAnimationFrame playback tick.
     * @param {number} time Browser animation timestamp.
     * @returns {void}
     */
    function animate(time) {
      setPlaybackAnimationFrame(0);
      if (!getPlaying() || documentRef?.visibilityState === "hidden") return;
      const currentGroup = getCurrentGroup();
      const images = getImages();
      if (!currentGroup || !images?.length || getPlaybackSwitching()) {
        schedulePlaybackAnimation();
        return;
      }
      const interval =
        (1000 / getGroupPlaybackFps(currentGroup)) *
        Math.max(0.001, getEffectiveFrameDurationMultiplier(getSelectedFrame(), currentGroup));
      let advanced = false;
      if (getLastPlay() <= 0) {
        setLastPlay(time);
      } else if (getPlaying() && time - getLastPlay() >= interval) {
        advancePlayback();
        const nextPlay = getLastPlay() + interval;
        setLastPlay(time - nextPlay > interval * 3 ? time : nextPlay);
        advanced = true;
      }
      if (!advanced && playbackNeedsContinuousDraw()) draw();
      schedulePlaybackAnimation();
    }

    /**
     * Starts the playback animation loop only while playback needs it.
     * @returns {void}
     */
    function schedulePlaybackAnimation() {
      if (!getPlaying() || getPlaybackAnimationFrame() || documentRef?.visibilityState === "hidden") return;
      if (typeof requestAnimationFrameRef !== "function") return;
      setPlaybackAnimationFrame(requestAnimationFrameRef(animate));
    }

    return {
      advancePlayback,
      animate,
      firstPlayableFrame,
      nextPlayableFrameInGroup,
      playbackChainGroup,
      schedulePlaybackAnimation,
      switchPlaybackGroup,
    };
  }

  return { canPlayGroup, createController, playableFrameCount };
});
