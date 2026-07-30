"use strict";

const defaultFs = require("node:fs");
const defaultPath = require("node:path");
const { createProjectInspection: defaultCreateProjectInspection } = require("../project_inspection");
const { EMPTY_TUNING, reslash: defaultReslash } = require("../project_store");
const { profileIdsForSceneText } = require("../scene_profiles");

const DEFAULT_GDSCRIPT_SCAN_LIMIT = 250;
const DEFAULT_GDSCRIPT_SKIP_DIRS = new Set([".git", ".godot", "addons", "node_modules", "_external_vfx"]);
const DEFAULT_SCENE_SKIP_DIRS = new Set([...DEFAULT_GDSCRIPT_SKIP_DIRS, ".import"]);

/**
 * Creates project validation and runtime inspection operations.
 * @param {{projectStore?:object,createProjectInspection?:(root:string)=>object,fs?:object,path?:object,reslash?:(value:string)=>string,gdscriptScanLimit?:number,gdscriptSkipDirs?:Set<string>,sceneSkipDirs?:Set<string>}} dependencies Validation dependencies.
 * @returns {{relativeProjectPath:(filePath:string,projectRoot:string)=>string,listSceneFiles:(projectRoot:string)=>object[],validateGdscriptTypeInference:(projectRoot:string,inspection?:object)=>string[],validateRuntimeSceneUsage:(project:object,manifest:object,inspection?:object)=>string[],validateRuntimeBindingReaders:(project:object,manifest:object,inspection?:object)=>string[],validateGameLocalBindingKeys:(project:object)=>string[]}} Validation operations.
 */
function createProjectValidation(dependencies = {}) {
  const {
    projectStore = null,
    createProjectInspection = defaultCreateProjectInspection,
    fs: fsApi = defaultFs,
    path: pathApi = defaultPath,
    reslash: reslashApi = defaultReslash,
    gdscriptScanLimit = DEFAULT_GDSCRIPT_SCAN_LIMIT,
    sceneSkipDirs = DEFAULT_SCENE_SKIP_DIRS,
  } = dependencies;
  const path = pathApi;
  const fs = fsApi;
  const reslash = reslashApi;
  const GDSCRIPT_SCAN_LIMIT = gdscriptScanLimit;
  const SCENE_SKIP_DIRS = sceneSkipDirs;

  function relativeProjectPath(filePath, projectRoot) {
    return reslash(path.relative(projectRoot, filePath));
  }

  function isGeneratedTunerScene(scenePath) {
    const normalized = reslash(String(scenePath || ""));
    return normalized.startsWith("xsxb_frame_tuner/runtime/");
  }

  function listSceneFiles(projectRoot, profiles = []) {
    const root = projectRoot ? path.resolve(String(projectRoot)) : "";
    const scenes = [];
    if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) return scenes;

    const walk = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SCENE_SKIP_DIRS.has(entry.name)) walk(fullPath);
          continue;
        }
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".tscn") continue;
        const scenePath = relativeProjectPath(fullPath, root);
        if (isGeneratedTunerScene(scenePath)) continue;
        let sceneText = "";
        try {
          sceneText = fs.readFileSync(fullPath, "utf8");
        } catch {
          sceneText = "";
        }
        const scene = {
          id: `res://${scenePath}`,
          label: path.basename(entry.name, ".tscn"),
          path: scenePath,
        };
        if (profiles.length) scene.profileIds = profileIdsForSceneText(sceneText, profiles);
        scenes.push(scene);
      }
    };

    walk(root);
    return scenes.sort((left, right) => left.id.localeCompare(right.id));
  }

  function gdscriptTypeWarning(filePath, projectRoot, lineNumber, message, line) {
    return `${relativeProjectPath(filePath, projectRoot)}:${lineNumber}: ${message}: ${line.trim()}`;
  }

  function gdscriptTextureInferenceWarning(filePath, projectRoot, lineNumber, line) {
    const match = line.match(/^\s*var\s+([A-Za-z_]\w*)\s*:=\s*(.+)$/);
    if (!match) return "";
    const variableName = match[1];
    const rhs = match[2];
    if (/\sas\s+[A-Za-z_]\w*/.test(rhs)) return "";
    const riskyRhs =
      /\b(load|preload)\s*\(/.test(rhs) ||
      /\bResourceLoader\.load\s*\(/.test(rhs) ||
      /\.get_frame_texture\s*\(/.test(rhs) ||
      /_load[A-Za-z0-9_]*texture\s*\(/i.test(rhs);
    if (!riskyRhs) return "";
    const typeHint = /texture/i.test(variableName) ? "Texture2D" : "explicit type";
    return gdscriptTypeWarning(
      filePath,
      projectRoot,
      lineNumber,
      `Godot may not infer this variable type; use "var ${variableName}: ${typeHint} = ..."`,
      line,
    );
  }

  function gdscriptTextureFunctionWarning(filePath, projectRoot, lineNumber, line) {
    const match = line.match(/^\s*func\s+(_load[A-Za-z0-9_]*texture)\s*\([^)]*\)\s*:\s*(?:#.*)?$/i);
    if (!match) return "";
    return gdscriptTypeWarning(
      filePath,
      projectRoot,
      lineNumber,
      `texture loader has no return type; use "func ${match[1]}(...) -> Texture2D:"`,
      line,
    );
  }

  function gdscriptBoxDrivenVisualWarning(filePath, projectRoot, lines, lineNumber, line) {
    const trimmed = line.trim();
    const visualPositionAssignment =
      /(?:sprite|visual|image|frame)[A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\.(?:position|global_position|offset)\s*=/.test(
        trimmed,
      );
    if (!visualPositionAssignment) return "";

    const context = lines
      .slice(Math.max(0, lineNumber - 4), Math.min(lines.length, lineNumber + 3))
      .join("\n");
    const hasBoxOffset =
      /\b(?:collision|hit|hurt)?box(?:es)?\b/i.test(context) ||
      /\bcollision_offset\b/i.test(context) ||
      /\b(?:collision|hit|hurt)_offset\b/i.test(context);
    if (!hasBoxOffset) return "";

    return gdscriptTypeWarning(
      filePath,
      projectRoot,
      lineNumber,
      "Runtime visual alignment must not use collision/hit/hurt box offsets; use XSXB character/group/frame visual transforms only",
      line,
    );
  }

  function validateGdscriptTypeInference(projectRoot, inspection = null) {
    const warnings = [];
    if (!projectRoot) return warnings;
    const root = path.resolve(String(projectRoot));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return warnings;
    const scripts = (inspection || createProjectInspection(root)).gdScripts;
    for (const script of scripts) {
      if (warnings.length >= GDSCRIPT_SCAN_LIMIT) break;
      script.lines.forEach((line, index) => {
        if (warnings.length >= GDSCRIPT_SCAN_LIMIT) return;
        const textureWarning = gdscriptTextureInferenceWarning(script.path, root, index + 1, line);
        if (textureWarning) warnings.push(textureWarning);
        const functionWarning = gdscriptTextureFunctionWarning(script.path, root, index + 1, line);
        if (functionWarning) warnings.push(functionWarning);
        const boxDrivenVisualWarning = gdscriptBoxDrivenVisualWarning(
          script.path,
          root,
          script.lines,
          index + 1,
          line,
        );
        if (boxDrivenVisualWarning) warnings.push(boxDrivenVisualWarning);
      });
    }
    if (warnings.length >= GDSCRIPT_SCAN_LIMIT) {
      warnings.push(`GDScript type scan stopped after ${GDSCRIPT_SCAN_LIMIT} warnings.`);
    }
    return warnings;
  }

  /**
   * Reports whether a project manifest contains at least one runtime animation.
   * @param {object|null|undefined} manifest Project animation manifest.
   * @returns {boolean} Whether runtime animation validation should run.
   */
  function manifestHasRuntimeAnimations(manifest) {
    return (Array.isArray(manifest?.profiles) ? manifest.profiles : []).some(
      (profile) => Array.isArray(profile?.animations) && profile.animations.length > 0,
    );
  }

  function collectRuntimeActorScripts(projectRoot, inspection = null) {
    const scriptTexts = new Map();
    const runtimeScripts = new Set(["xsxb_frame_tuner/runtime/xsxb_frame_actor.gd"]);
    for (const script of (inspection || createProjectInspection(projectRoot)).gdScripts) {
      scriptTexts.set(script.relativePath, script.text);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [relPath, text] of scriptTexts.entries()) {
        if (runtimeScripts.has(relPath)) continue;
        const extendsMatch = text.match(/extends\s+"res:\/\/([^"]+\.gd)"/);
        if (!extendsMatch) continue;
        if (!runtimeScripts.has(reslash(extendsMatch[1]))) continue;
        runtimeScripts.add(relPath);
        changed = true;
      }
    }
    return runtimeScripts;
  }

  function validateRuntimeSceneUsage(project, manifest, inspection = null) {
    const warnings = [];
    if (!manifestHasRuntimeAnimations(manifest)) return warnings;
    const projectRoot = project?.projectRoot ? path.resolve(String(project.projectRoot)) : "";
    if (!projectRoot || !fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory())
      return warnings;

    const details = inspection || createProjectInspection(projectRoot);
    const runtimeScripts = collectRuntimeActorScripts(projectRoot, details);
    let sceneUsesRuntime = false;
    for (const scene of details.scenes) {
      if (isGeneratedTunerScene(scene.relativePath)) continue;
      if (/res:\/\/xsxb_frame_tuner\/runtime\/xsxb_frame_actor\.tscn/.test(scene.text)) {
        sceneUsesRuntime = true;
        break;
      }
      if (Array.from(runtimeScripts).some((scriptRel) => scene.text.includes(`res://${scriptRel}`))) {
        sceneUsesRuntime = true;
        break;
      }
    }
    if (!sceneUsesRuntime) {
      warnings.push(
        "Imported XSXB animations are synced, but no gameplay scene appears to instantiate xsxb_frame_actor.tscn or a script extending xsxb_frame_actor.gd. The generated runtime test scene can play the data, but the actual game scene will not change until a gameplay node uses the XSXB runtime.",
      );
    }
    return warnings;
  }

  function validateRuntimeBindingReaders(project, manifest, inspection = null) {
    const warnings = [];
    const projectRoot = project?.projectRoot ? path.resolve(String(project.projectRoot)) : "";
    if (!projectRoot || !fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory())
      return warnings;

    const paths = projectStore.projectPaths(project);
    const frameAudioBindings = projectStore.readJson(paths.frameAudio, []);
    const frameImageAttachments = projectStore.readJson(paths.frameImageAttachments, []);
    const tuning = projectStore.readJson(paths.tuning, EMPTY_TUNING);
    const frameBoxOverrides =
      tuning?.frame_box_overrides && typeof tuning.frame_box_overrides === "object"
        ? tuning.frame_box_overrides
        : {};
    const sceneSettings =
      tuning?.scene_settings && typeof tuning.scene_settings === "object" ? tuning.scene_settings : {};
    const hasRuntimeAnimations = manifestHasRuntimeAnimations(manifest);
    const needsFrameAudio =
      hasRuntimeAnimations || (Array.isArray(frameAudioBindings) && frameAudioBindings.length > 0);
    const needsFrameImageAttachments =
      hasRuntimeAnimations || (Array.isArray(frameImageAttachments) && frameImageAttachments.length > 0);
    const needsFramePlayback = hasRuntimeAnimations;
    const needsFrameBoxes = Object.keys(frameBoxOverrides).length > 0;
    const needsSceneScale = hasRuntimeAnimations || Object.keys(sceneSettings).length > 0;
    if (
      !needsFrameAudio &&
      !needsFrameImageAttachments &&
      !needsFramePlayback &&
      !needsFrameBoxes &&
      !needsSceneScale
    )
      return warnings;

    const found = {
      frameAudioBindings: false,
      frameAudioPlayback: false,
      frameAudioAdvancePlayback: false,
      frameAudioFrameVisitTrigger: false,
      frameImageAttachments: false,
      framePlaybackOverrides: false,
      groupPlayback: false,
      playbackIdempotent: false,
      sceneSettings: false,
      sceneScaleInterface: false,
      sceneScaleApplied: false,
      sceneScaleAppliedToBoxes: false,
      frameBoxOverrides: false,
      runtimeHitboxInterface: false,
      runtimeHurtboxInterface: false,
      runtimeAppliesHurtbox: false,
      runtimeSourceFacing: false,
      hardcodedGameplayBodyCollision: false,
      gameplayBodyCollisionUsesRuntime: false,
      gameplayBodyCollisionGroundAnchored: false,
      hardcodedGameplayAttackRange: false,
      gameplayAttackUsesRuntimeHitbox: false,
      animationDurationInterface: false,
      startRunState: false,
      startRunTransitionsToRun: false,
    };

    for (const script of (inspection || createProjectInspection(projectRoot)).gdScripts) {
      const text = script.text;
      if (/frame_audio_bindings\.json|frame_audio_bindings/i.test(text)) found.frameAudioBindings = true;
      if (/AudioStream|AudioStreamPlayer|\.play\s*\(/.test(text)) found.frameAudioPlayback = true;
      if (
        /while\s+_frame_clock\s*>=\s*_current_frame_duration\s*\(\s*\)[\s\S]{0,900}_play_current_frame_audio\s*\(\s*\)/.test(
          text,
        ) ||
        /while\s+_frame_clock\s*>=\s*_current_frame_duration\s*\(\s*\)[\s\S]{0,900}_play_frame_audio\s*\(/.test(
          text,
        )
      )
        found.frameAudioAdvancePlayback = true;
      if (/_frame_visit_serial/.test(text) && /trigger_key/.test(text) && /_last_audio_key/.test(text))
        found.frameAudioFrameVisitTrigger = true;
      if (/frame_image_attachments\.json|frame_image_attachments/i.test(text))
        found.frameImageAttachments = true;
      if (/frame_playback_overrides/i.test(text)) found.framePlaybackOverrides = true;
      if (/__group|group_playback/i.test(text)) found.groupPlayback = true;
      if (
        /func\s+play_frame_animation\s*\([^)]*animation_name/.test(text) &&
        /_current_animation\s*==\s*animation_name/.test(text) &&
        /\brestart\b/.test(text)
      )
        found.playbackIdempotent = true;
      if (/scene_settings/i.test(text)) found.sceneSettings = true;
      if (/func\s+scene_scale\s*\(/.test(text)) found.sceneScaleInterface = true;
      if (
        /_character_scale\s*\(\s*\)\s*\*\s*scene_scale\s*\(\s*\)|scene_scale\s*\(\s*\)\s*\*\s*_character_scale\s*\(\s*\)/.test(
          text,
        )
      )
        found.sceneScaleApplied = true;
      if (
        /_box_actor_size\s*\([^)]*runtime_scale/.test(text) &&
        /_box_actor_position\s*\([^)]*runtime_scale/.test(text)
      )
        found.sceneScaleAppliedToBoxes = true;
      if (/frame_box_overrides/i.test(text)) found.frameBoxOverrides = true;
      if (/current_hitbox_enabled|current_hitbox_size|current_hitbox_position/.test(text))
        found.runtimeHitboxInterface = true;
      if (/current_hurtbox_enabled|current_hurtbox_size|current_hurtbox_position/.test(text))
        found.runtimeHurtboxInterface = true;
      if (/func\s+_apply_frame_hurtbox\s*\(/.test(text)) found.runtimeAppliesHurtbox = true;
      if (/source_faces_left|func\s+render_facing\s*\(/.test(text)) found.runtimeSourceFacing = true;
      const hasGameplayMovementCollision =
        /BodyCollision|movement_collision_shape|movement_rectangle_shape/i.test(text);
      if (
        hasGameplayMovementCollision &&
        /RectangleShape2D\.new\s*\(\s*\)/.test(text) &&
        /\.size\s*=/.test(text)
      )
        found.hardcodedGameplayBodyCollision = true;
      if (
        hasGameplayMovementCollision &&
        /current_collision_box_size|current_collision_box_position|current_grounded_collision_box_position/.test(
          text,
        )
      )
        found.gameplayBodyCollisionUsesRuntime = true;
      if (
        hasGameplayMovementCollision &&
        /current_grounded_collision_box_position|-\s*size\.y\s*\*\s*0\.5|-\s*_body_shape\.size\.y\s*\*\s*0\.5|-\s*runtime_shape\.size\.y\s*\*\s*0\.5|-\s*movement_rectangle_shape\.size\.y\s*\*\s*0\.5/.test(
          text,
        )
      )
        found.gameplayBodyCollisionGroundAnchored = true;
      if (/ATTACK_RANGE|ATTACK_HEIGHT|AIR_ATTACK_RANGE|AIR_ATTACK_HEIGHT/.test(text))
        found.hardcodedGameplayAttackRange = true;
      if (
        /current_hitbox_size|current_hitbox_position|current_hitbox_enabled/.test(text) &&
        /current_hurtbox_size|current_hurtbox_position|current_hurtbox_enabled|_runtime_hurt_rect/.test(text)
      )
        found.gameplayAttackUsesRuntimeHitbox = true;
      if (/func\s+(?:current_)?animation_duration\s*\(|animation_finished\s*\./.test(text))
        found.animationDurationInterface = true;
      if (/ActionState\.START_RUN/.test(text) && /_enter_start_run/.test(text) && /_enter_run/.test(text))
        found.startRunState = true;
      if (/finished_state\s*==\s*ActionState\.START_RUN/.test(text)) found.startRunTransitionsToRun = true;
    }

    if (needsFrameAudio && !found.frameAudioBindings) {
      warnings.push(
        "Runtime must support XSXB frame audio, but no GDScript appears to read frame_audio_bindings.json.",
      );
    } else if (needsFrameAudio && !found.frameAudioPlayback) {
      warnings.push(
        "Runtime reads frame audio bindings, but no GDScript AudioStream/AudioStreamPlayer playback path was found.",
      );
    } else if (needsFrameAudio && !found.frameAudioAdvancePlayback) {
      warnings.push(
        "Runtime frame audio only appears to play during final frame rendering; very short frame durations can skip bound SFX frames.",
      );
    } else if (needsFrameAudio && !found.frameAudioFrameVisitTrigger) {
      warnings.push(
        "Runtime frame audio de-duplication appears keyed only by frame key; looped one-frame or repeated same-frame SFX can be blocked instead of triggering on frame entry.",
      );
    }
    if (needsFrameImageAttachments && !found.frameImageAttachments) {
      warnings.push(
        "Runtime must support XSXB frame image attachments, but no GDScript appears to read frame_image_attachments.json.",
      );
    }
    if (needsFramePlayback && !found.framePlaybackOverrides) {
      warnings.push(
        "Runtime must support XSXB frame playback overrides, but no GDScript appears to read frame_playback_overrides.",
      );
    } else if (needsFramePlayback && !found.groupPlayback) {
      warnings.push(
        "Runtime reads frame playback overrides, but no GDScript appears to handle <profile>/<animation>:__group timing.",
      );
    } else if (needsFramePlayback && !found.animationDurationInterface) {
      warnings.push(
        "Runtime reads group timing, but no animation_duration/current_animation_duration interface was found for gameplay action timers.",
      );
    } else if (needsFramePlayback && !found.playbackIdempotent) {
      warnings.push(
        "Runtime play_frame_animation appears to restart the same animation on every call; repeated gameplay calls can make an animation look like one frame.",
      );
    }
    if (needsFrameBoxes && !found.frameBoxOverrides) {
      warnings.push(
        "Runtime must support XSXB frame boxes, but no GDScript appears to read frame_box_overrides.",
      );
    } else if (needsFrameBoxes && needsSceneScale && !found.sceneScaleAppliedToBoxes) {
      warnings.push(
        "Runtime reads frame boxes, but box size/position does not appear to use the same scene_scale() runtime scale as the sprite.",
      );
    } else if (
      needsFrameBoxes &&
      (!found.runtimeHitboxInterface || !found.runtimeHurtboxInterface || !found.runtimeAppliesHurtbox)
    ) {
      warnings.push(
        "Runtime frame boxes are incomplete: gameplay must be able to query hitbox and hurtbox, and runtime must apply hurtbox with the same transform as collisionbox/hitbox.",
      );
    }
    if (needsSceneScale && !found.sceneSettings) {
      warnings.push("Runtime must support XSXB scene scale, but no GDScript appears to read scene_settings.");
    } else if (needsSceneScale && !found.sceneScaleInterface) {
      warnings.push(
        "Runtime reads scene_settings, but no scene_scale() interface was found for gameplay movement scaling.",
      );
    } else if (needsSceneScale && !found.sceneScaleApplied) {
      warnings.push(
        "Runtime scene scale exists, but visual scale does not appear to multiply character scale by scene_scale().",
      );
    }
    if (hasRuntimeAnimations && !found.runtimeSourceFacing) {
      warnings.push(
        "Runtime has no source_faces_left/render_facing interface; imported art facing left can make gameplay directions render backwards.",
      );
    }
    if (needsFrameBoxes && found.hardcodedGameplayBodyCollision && !found.gameplayBodyCollisionUsesRuntime) {
      warnings.push(
        "Gameplay creates its own movement collision rectangle but does not sync it from xsxb_frame_actor current_collision_box_*; tuner box and scene scale changes will not affect in-game movement collision.",
      );
    } else if (
      needsFrameBoxes &&
      found.hardcodedGameplayBodyCollision &&
      found.gameplayBodyCollisionUsesRuntime &&
      !found.gameplayBodyCollisionGroundAnchored
    ) {
      warnings.push(
        "Gameplay movement collision sync appears to use the runtime collisionbox Y position directly; grounded movement should anchor the collision bottom at the actor origin so visual Y offsets are not cancelled by floor collision.",
      );
    }
    if (needsFrameBoxes && found.hardcodedGameplayAttackRange && !found.gameplayAttackUsesRuntimeHitbox) {
      warnings.push(
        "Gameplay still appears to use fixed attack range/height without intersecting xsxb_frame_actor hitbox against target hurtbox; tuner hitbox changes will not affect combat.",
      );
    }
    if (hasRuntimeAnimations && found.startRunState && !found.startRunTransitionsToRun) {
      warnings.push(
        "Runtime START_RUN state appears not to transition into RUN after the start animation; holding a direction can leave movement locked.",
      );
    }

    return warnings;
  }

  function validateGameLocalBindingKeys(project) {
    const warnings = [];
    const projectRoot = project?.projectRoot ? path.resolve(String(project.projectRoot)) : "";
    const projectId = String(project?.id || "");
    if (!projectRoot || !projectId || !fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory())
      return warnings;

    const files = [
      ["frame_audio_bindings.json", "frame audio"],
      ["frame_image_attachments.json", "frame image attachment"],
    ];
    for (const [fileName, label] of files) {
      const filePath = path.join(projectRoot, "xsxb_frame_tuner", "data", "projects", projectId, fileName);
      if (!fs.existsSync(filePath)) continue;
      const entries = projectStore.readJson(filePath, []);
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const key = String(entry?.key || entry?.frameKey || "");
        if (!key) continue;
        if (key.split(":").length <= 2) continue;
        warnings.push(
          `Game-local ${label} binding key "${key}" is source-heavy; Save sync must write stable <profile>/<animation>:<frame> keys.`,
        );
        break;
      }
    }
    return warnings;
  }

  return {
    relativeProjectPath,
    listSceneFiles,
    validateGdscriptTypeInference,
    manifestHasRuntimeAnimations,
    validateRuntimeSceneUsage,
    validateRuntimeBindingReaders,
    validateGameLocalBindingKeys,
  };
}

module.exports = { createProjectValidation };
