(function attachXFrameBoxDefaults(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameBoxDefaults = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates collision-box and combat-box default rules.
   * @param {{
   *   getCurrentGroup?:()=>object|null,
   *   getSelectedFrame?:()=>number,
   *   getValues?:()=>object,
   *   getConfig?:()=>object|null,
   *   framePlayback?:(index:number,group:object)=>{disabled?:boolean},
   *   cloneVector:(value:object,fallback?:object)=>{x:number,y:number},
   *   clampNumber:(value:number,min:number,max:number)=>number,
   *   collisionOffsetYForHeight:(height:number)=>number,
   *   normalizeFrameBox:(boxName:string,box:object)=>object,
   *   usesCanvasFootAnchor?:(group:object)=>boolean,
   *   sourceBodyCenterForBox?:(index:number,group:object,images?:Array<object>)=>object,
   *   sourceAnchorForBox?:(index:number,group:object,images?:Array<object>)=>object,
   * }} dependencies Controller dependencies.
   * @returns {object} Collision-box and combat-box operations.
   */
  function createController(dependencies) {
    const {
      getCurrentGroup = () => null,
      getSelectedFrame = () => 0,
      getValues = () => ({}),
      getConfig = () => null,
      framePlayback = () => ({ disabled: false }),
      cloneVector,
      clampNumber,
      collisionOffsetYForHeight,
      normalizeFrameBox,
      usesCanvasFootAnchor = () => false,
      sourceBodyCenterForBox = () => ({ x: 0, y: 0, rect: { width: 1, height: 1 } }),
      sourceAnchorForBox = () => ({ x: 0, y: 0 }),
    } = dependencies;

    /**
     * Returns the configured references with a safe empty fallback.
     * @returns {object} Reference settings.
     */
    function references() {
      return getConfig()?.references || {};
    }

    /**
     * Returns a default hitbox offset for a group.
     * @param {object|null} [group] Animation group.
     * @returns {{x:number,y:number}} Hitbox offset.
     */
    function defaultHitboxOffset(group = getCurrentGroup()) {
      if (group?.tuningTarget === "soul") return cloneVector(defaultSoulHitbox(group).offset);
      const map = {
        stand_attack: "stand_attack_hitbox_offset",
        air_attack: "air_attack_hitbox_offset",
        crouch_attack: "crouch_attack_hitbox_offset",
      };
      const key = map[group?.name];
      const tuningDefaults = getConfig()?.tuningDefaults || {};
      return cloneVector((key && (getValues()[key] ?? tuningDefaults[key])) || { x: 72, y: 0 });
    }

    /**
     * Builds searchable group text used by combat-box rules.
     * @param {object|null} [group] Animation group.
     * @returns {string} Lowercase group text.
     */
    function boxRuleText(group = getCurrentGroup()) {
      return [group?.name, group?.runtimeAnimation, group?.skillName, group?.source]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    }

    /**
     * Tests a token against searchable group text.
     * @param {object|null} group Animation group.
     * @param {string} tokenPattern Regular-expression token pattern.
     * @returns {boolean} Whether the group contains the token.
     */
    function hasBoxRuleToken(group, tokenPattern) {
      return new RegExp(`(^|[\\s_-])(${tokenPattern})(?=$|[\\s_-])`, "i").test(boxRuleText(group));
    }

    /**
     * Returns whether a group is known to be non-attack animation.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether the group is non-attack.
     */
    function isNonAttackAnimationGroup(group = getCurrentGroup()) {
      return hasBoxRuleToken(
        group,
        "idle|stand|walk|run|jump|fall|land|hurt|damage|death|die|dead|stun|turn|talk|interact",
      );
    }

    /**
     * Returns whether a group should have an active hitbox.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether the group is an attack animation.
     */
    function isAttackAnimationGroup(group = getCurrentGroup()) {
      if (group?.hasHitbox === false) return false;
      if (group?.hasHitbox === true) return true;
      if (group?.tuningTarget === "soul") {
        return ["attack1", "attack2", "run_attack", "air_attack1", "parry1", "parry2", "parry3"].includes(
          group?.name,
        );
      }
      if (["stand_attack", "air_attack", "crouch_attack"].includes(group?.name)) return true;
      if (
        hasBoxRuleToken(
          group,
          "attack|atk|slash|strike|shoot|shot|fire|skill|cast|stab|punch|kick|bite|claw|parry|counter",
        )
      )
        return true;
      if (isNonAttackAnimationGroup(group)) return false;
      return false;
    }

    /**
     * Returns whether the default hitbox is active for a frame.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether the hitbox is active.
     */
    function hitboxActiveByDefault(index = getSelectedFrame(), group = getCurrentGroup()) {
      if (group?.tuningTarget === "soul") return soulHitboxActiveByDefault(index, group);
      if (!isAttackAnimationGroup(group)) return false;
      if (!["stand_attack", "air_attack", "crouch_attack"].includes(group?.name)) {
        return !framePlayback(index, group).disabled;
      }
      const frameCount = Math.max(group.frames.length, 1);
      const frameStart = index / frameCount;
      const frameEnd = (index + 1) / frameCount;
      const activeStart = 0.045 / 0.28;
      const activeEnd = 1 - 0.03 / 0.28;
      return frameEnd >= activeStart && frameStart <= activeEnd;
    }

    /**
     * Creates the default hurtbox for a frame.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @returns {object} Default hurtbox.
     */
    function defaultHurtbox(index = getSelectedFrame(), group = getCurrentGroup(), groupImages = []) {
      const configReferences = references();
      if (group?.tuningTarget === "soul") {
        return {
          offset: cloneVector(configReferences.soulHurtboxOffset || { x: 0, y: -310 }),
          size: cloneVector(configReferences.soulHurtboxSize || { x: 190, y: 560 }),
          rotation: 0,
          enabled: soulHurtboxActiveByDefault(index, group),
        };
      }
      const crouching = ["crouch", "crawl", "slide", "crouch_attack"].includes(group?.name);
      if (usesCanvasFootAnchor(group)) {
        const body = sourceBodyCenterForBox(index, group, groupImages);
        return {
          offset: { x: body.x, y: body.y },
          size: {
            x: clampNumber(
              body.rect.width * (isAttackAnimationGroup(group) ? 0.88 : 0.78),
              8,
              Math.max(8, body.rect.width),
            ),
            y: clampNumber(body.rect.height * (crouching ? 0.72 : 0.82), 8, Math.max(8, body.rect.height)),
          },
          rotation: 0,
          enabled: true,
        };
      }
      return {
        offset: cloneVector(
          crouching ? configReferences.crouchHurtboxOffset : configReferences.playerHurtboxOffset,
        ),
        size: cloneVector(
          crouching ? configReferences.crouchHurtboxSize : configReferences.playerHurtboxSize,
        ),
        rotation: 0,
        enabled: true,
      };
    }

    /**
     * Creates the default hitbox for a frame.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @returns {object} Default hitbox.
     */
    function defaultHitbox(index = getSelectedFrame(), group = getCurrentGroup(), groupImages = []) {
      const configReferences = references();
      if (group?.tuningTarget === "soul") {
        return {
          ...defaultSoulHitbox(group),
          enabled: soulHitboxActiveByDefault(index, group),
        };
      }
      if (usesCanvasFootAnchor(group) && isAttackAnimationGroup(group)) {
        const body = sourceBodyCenterForBox(index, group, groupImages);
        const anchor = sourceAnchorForBox(index, group, groupImages);
        const rect = body.rect;
        return {
          offset: {
            x: rect.x + rect.width * 0.72 - anchor.x,
            y: body.y - rect.height * 0.08,
          },
          size: {
            x: clampNumber(rect.width * 0.34, 8, Math.max(8, rect.width)),
            y: clampNumber(rect.height * 0.24, 6, Math.max(6, rect.height)),
          },
          rotation: 0,
          enabled: hitboxActiveByDefault(index, group),
        };
      }
      const offset = defaultHitboxOffset(group);
      const local = cloneVector(configReferences.attackHitboxLocalOffset || { x: 0, y: -72 });
      return {
        offset: { x: offset.x + local.x, y: offset.y + local.y },
        size: cloneVector(configReferences.attackHitboxSize || { x: 118, y: 76 }),
        rotation: 0,
        enabled: hitboxActiveByDefault(index, group),
      };
    }

    /**
     * Creates the default collision box for a frame.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @returns {object} Default collision box.
     */
    function defaultCollisionBox(index = getSelectedFrame(), group = getCurrentGroup(), groupImages = []) {
      const body = sourceBodyCenterForBox(index, group, groupImages);
      const visualWidth = Math.max(1, Number(body.rect.width || 96));
      const visualHeight = Math.max(1, Number(body.rect.height || 160));
      const widthRatio = Number(group?.collisionWidthRatio || 0.42);
      const heightRatio = Number(group?.collisionHeightRatio || 0.88);
      const width = Math.round(clampNumber(visualWidth * widthRatio, 4, Math.max(4, visualWidth)));
      const height = Math.round(clampNumber(visualHeight * heightRatio, 4, Math.max(4, visualHeight)));
      return normalizeFrameBox("collisionbox", {
        offset: { x: body.x, y: collisionOffsetYForHeight(height) },
        size: { x: width, y: height },
        rotation: 0,
        enabled: true,
      });
    }

    /**
     * Creates a Soul-specific hitbox using the configured attack family.
     * @param {object|null} [group] Animation group.
     * @returns {object} Default Soul hitbox.
     */
    function defaultSoulHitbox(group = getCurrentGroup()) {
      const configReferences = references();
      if (["parry1", "parry2", "parry3"].includes(group?.name)) {
        return {
          offset: cloneVector(configReferences.soulParryHitboxOffset || { x: 135, y: -315 }),
          size: cloneVector(configReferences.soulParryHitboxSize || { x: 260, y: 430 }),
          rotation: 0,
        };
      }
      if (group?.name === "run_attack") {
        return {
          offset: cloneVector(configReferences.soulRunAttackHitboxOffset || { x: 285, y: -285 }),
          size: cloneVector(configReferences.soulRunAttackHitboxSize || { x: 390, y: 220 }),
          rotation: 0,
        };
      }
      if (group?.name === "air_attack1") {
        return {
          offset: cloneVector(configReferences.soulAirAttackHitboxOffset || { x: 255, y: -305 }),
          size: cloneVector(configReferences.soulAirAttackHitboxSize || { x: 340, y: 230 }),
          rotation: 0,
        };
      }
      return {
        offset: cloneVector(configReferences.soulStandAttackHitboxOffset || { x: 245, y: -295 }),
        size: cloneVector(configReferences.soulStandAttackHitboxSize || { x: 330, y: 210 }),
        rotation: 0,
      };
    }

    /**
     * Returns whether Soul's default hitbox is active for a frame.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether the hitbox is active.
     */
    function soulHitboxActiveByDefault(index = getSelectedFrame(), group = getCurrentGroup()) {
      if (framePlayback(index, group).disabled) return false;
      const parryRange = soulParryGuardFrameRange(group);
      if (parryRange) return index >= parryRange.start && index <= parryRange.end;
      if (group?.name === "attack1") return index >= 1 && index <= 9;
      if (group?.name === "attack2") return index >= 4 && index <= 13;
      if (group?.name === "run_attack") return index >= 1 && index <= 6;
      if (group?.name === "air_attack1") return index >= 2 && index <= 5;
      return false;
    }

    /**
     * Returns the playable parry guard range after disabled frames are removed.
     * @param {object|null} [group] Animation group.
     * @returns {{start:number,end:number}|null} Playable guard range.
     */
    function soulParryGuardFrameRange(group = getCurrentGroup()) {
      const raw = soulRawParryGuardFrameRange(group);
      if (!raw) return null;
      return {
        start: firstPlayableFrameInRange(group, raw.start, raw.end),
        end: lastPlayableFrameInRange(group, raw.start, raw.end),
      };
    }

    /**
     * Returns the configured raw parry guard range.
     * @param {object|null} [group] Animation group.
     * @returns {{start:number,end:number}|null} Raw guard range.
     */
    function soulRawParryGuardFrameRange(group = getCurrentGroup()) {
      if (group?.name === "parry1") return { start: 3, end: 4 };
      if (group?.name === "parry2") return { start: 4, end: 5 };
      if (group?.name === "parry3") return { start: 2, end: 6 };
      return null;
    }

    /**
     * Finds the first playable frame in an inclusive range.
     * @param {object} group Animation group.
     * @param {number} start Range start.
     * @param {number} end Range end.
     * @returns {number} First playable index or the original start.
     */
    function firstPlayableFrameInRange(group, start, end) {
      for (let index = start; index <= end; index += 1) {
        if (!framePlayback(index, group).disabled) return index;
      }
      return start;
    }

    /**
     * Finds the last playable frame in an inclusive range.
     * @param {object} group Animation group.
     * @param {number} start Range start.
     * @param {number} end Range end.
     * @returns {number} Last playable index or the original end.
     */
    function lastPlayableFrameInRange(group, start, end) {
      for (let index = end; index >= start; index -= 1) {
        if (!framePlayback(index, group).disabled) return index;
      }
      return end;
    }

    /**
     * Returns whether a Soul actor's default hurtbox is active.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether the hurtbox is active.
     */
    function soulHurtboxActiveByDefault(index = getSelectedFrame(), group = getCurrentGroup()) {
      return (
        group?.tuningTarget === "soul" && group?.type === "actor" && !framePlayback(index, group).disabled
      );
    }

    return {
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
    };
  }

  return { createController };
});
