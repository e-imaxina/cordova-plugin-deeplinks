/*
Script activates support for Universal Links in the application by setting proper preferences in the xcode project file.
Which is:
- deployment target set to iOS 9.0
- .entitlements file added to project PBXGroup and PBXFileReferences section
- path to .entitlements file added to Code Sign Entitlements preference
*/

const path = require('path');
const compare = require('node-version-compare');
const glob = require('glob');
const xcode = require('xcode');
const fileSystem = require('fs');
const shelljs = require('shelljs');
const ConfigXmlHelper = require('../configXmlHelper.js');

const IOS_DEPLOYMENT_TARGET = '8.0';
const COMMENT_KEY = /_comment$/;
let context;

module.exports = {
  enableAssociativeDomainsCapability,
};

// region Public API

/**
 * Activate associated domains capability for the application.
 *
 * @param {Object} cordovaContext - cordova context object
 */
function enableAssociativeDomainsCapability(cordovaContext) {
  context = cordovaContext;

  const projectFile = loadProjectFile();

  // adjust preferences
  activateAssociativeDomains(projectFile.xcode);

  // add entitlements file to pbxfilereference
  addPbxReference(projectFile.xcode);

  // save changes
  projectFile.write();
}

// endregion

// region Alter project file preferences

/**
 * Activate associated domains support in the xcode project file:
 * - set deployment target to ios 9;
 * - add .entitlements file to Code Sign Entitlements preference.
 *
 * @param {Object} xcodeProject - xcode project preferences; all changes are made in that instance
 */
function activateAssociativeDomains(xcodeProject) {
  const configurations = nonComments(
    xcodeProject.pbxXCBuildConfigurationSection(),
  );
  const entitlementsFilePath = pathToEntitlementsFile();
  let config;
  let buildSettings;
  let deploymentTargetIsUpdated;

  for (config in configurations) {
    buildSettings = configurations[config].buildSettings;
    buildSettings.CODE_SIGN_ENTITLEMENTS = `"${entitlementsFilePath}"`;

    // if deployment target is less then the required one - increase it
    if (buildSettings.IPHONEOS_DEPLOYMENT_TARGET) {
      if (
        compare(
          buildSettings.IPHONEOS_DEPLOYMENT_TARGET,
          IOS_DEPLOYMENT_TARGET,
        ) == -1
      ) {
        buildSettings.IPHONEOS_DEPLOYMENT_TARGET = IOS_DEPLOYMENT_TARGET;
        deploymentTargetIsUpdated = true;
      }
    } else {
      buildSettings.IPHONEOS_DEPLOYMENT_TARGET = IOS_DEPLOYMENT_TARGET;
      deploymentTargetIsUpdated = true;
    }
  }

  if (deploymentTargetIsUpdated) {
    console.log(
      `IOS project now has deployment target set as: ${IOS_DEPLOYMENT_TARGET}`,
    );
  }

  console.log(
    `IOS project Code Sign Entitlements now set to: ${entitlementsFilePath}`,
  );
}

// endregion

// region PBXReference methods

/**
 * Add .entitlemets file into the project.
 *
 * @param {Object} xcodeProject - xcode project preferences; all changes are made in that instance
 */
function addPbxReference(xcodeProject) {
  const fileReferenceSection = nonComments(
    xcodeProject.pbxFileReferenceSection(),
  );
  const entitlementsFileName = path.basename(pathToEntitlementsFile());

  if (isPbxReferenceAlreadySet(fileReferenceSection, entitlementsFileName)) {
    console.log('Entitlements file is in reference section.');
    return;
  }

  console.log('Entitlements file is not in references section, adding it');
  xcodeProject.addResourceFile(entitlementsFileName);
}

/**
 * Check if .entitlemets file reference already set.
 *
 * @param {Object} fileReferenceSection - PBXFileReference section
 * @param {String} entitlementsRelativeFilePath - relative path to entitlements file
 * @return true - if reference is set; otherwise - false
 */
function isPbxReferenceAlreadySet(
  fileReferenceSection,
  entitlementsRelativeFilePath,
) {
  let isAlreadyInReferencesSection = false;
  let uuid;
  let fileRefEntry;

  for (uuid in fileReferenceSection) {
    fileRefEntry = fileReferenceSection[uuid];
    if (
      fileRefEntry.path
      && fileRefEntry.path.indexOf(entitlementsRelativeFilePath) > -1
    ) {
      isAlreadyInReferencesSection = true;
      break;
    }
  }

  return isAlreadyInReferencesSection;
}

// region Xcode project file helpers

/**
 * Load iOS project file from platform specific folder.
 *
 * @return {Object} projectFile - project file information
 */
function loadProjectFile() {
  let platform_ios;
  let projectFile;

  try {
    // try pre-5.0 cordova structure
    platform_ios = context.requireCordovaModule(
      'cordova-lib/src/plugman/platforms',
    ).ios;

    projectFile = platform_ios.parseProjectFile(iosPlatformPath());
  } catch (e) {
    try {
      // let's try cordova 5.0 structure
      platform_ios = context.requireCordovaModule('ios');
      projectFile = platform_ios.parseProjectFile(iosPlatformPath());
    } catch (e) {
      // Then cordova 7.0
      const project_files = glob.sync(
        path.join(iosPlatformPath(), '*.xcodeproj', 'project.pbxproj'),
      );

      if (project_files.length === 0) {
        throw new Error(
          'does not appear to be an xcode project (no xcode project file)',
        );
      }

      const pbxPath = project_files[0];

      const xcodeproj = xcode.project(pbxPath);
      xcodeproj.parseSync();

      projectFile = {
        xcode: xcodeproj,
        write() {
          const fs = fileSystem;

          const frameworks_file = path.join(
            iosPlatformPath(),
            'frameworks.json',
          );
          let frameworks = {};
          try {
            frameworks = context.requireCordovaModule(frameworks_file);
          } catch (e) {}

          fs.writeFileSync(pbxPath, xcodeproj.writeSync());
          if (Object.keys(frameworks).length === 0) {
            // If there is no framework references remain in the project, just remove this file
            shelljs.rm('-rf', frameworks_file);
            return;
          }
          fs.writeFileSync(
            frameworks_file,
            JSON.stringify(this.frameworks, null, 4),
          );
        },
      };
    }
  }

  return projectFile;
}

/**
 * Remove comments from the file.
 *
 * @param {Object} obj - file object
 * @return {Object} file object without comments
 */
function nonComments(obj) {
  const keys = Object.keys(obj);
  const newObj = {};

  for (let i = 0, len = keys.length; i < len; i++) {
    if (!COMMENT_KEY.test(keys[i])) {
      newObj[keys[i]] = obj[keys[i]];
    }
  }

  return newObj;
}

// endregion

// region Path helpers

function iosPlatformPath() {
  return path.join(projectRoot(), 'platforms', 'ios');
}

function projectRoot() {
  return context.opts.projectRoot;
}

function pathToEntitlementsFile() {
  const configXmlHelper = new ConfigXmlHelper(context);

  const projectName = configXmlHelper.getProjectName();

  const fileName = `${projectName}.entitlements`;

  return path.join(projectName, 'Resources', fileName);
}

// endregion
