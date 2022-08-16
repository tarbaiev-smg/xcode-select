import * as path from 'path'
import * as fs from 'fs'

import * as core from '@actions/core'
import * as exec from '@actions/exec'

import * as semver from 'semver'
import * as plist from 'simple-plist'

class Install {
  version: semver.SemVer
  beta: boolean
  shortVersion: string
  path: string

  constructor(applicationPath: string) {
    const info = plist.readFileSync(path.join(applicationPath, 'Contents/Info.plist'))

    const version = semver.coerce(info['CFBundleShortVersionString'])
    if (!version) {
      throw Error(`Cannot parse version number ${info['CFBundleShortVersionString']} from ${applicationPath}`)
    }

    this.version = version
    this.beta = info['CFBundleIconName'].includes('Beta')
    this.shortVersion = info['CFBundleShortVersionString']
    this.path = applicationPath
  }
}

function matchInstall(installs: Install[], versionSpec: string): Install | undefined {
  if (versionSpec === 'latest') {
    return installs[0]
  }
  return installs.find(install => semver.satisfies(install.version, versionSpec))
}

function isValidVersionSpecification(version: string): boolean {
  return version === 'latest' || semver.coerce(version) != null
}

async function discoverInstalls(root: string, beta: boolean): Promise<Install[]> {
  const installs: Install[] = []

  const dir = await fs.promises.opendir(root)

  for await (const dirent of dir) {
    if (dirent.name.startsWith('Xcode') && !dirent.isSymbolicLink()) {
      core.info('${dirent}')
      const install = new Install(path.join(root, dirent.name))
      if (install.beta === beta) {
        installs.push(install)
      }
    }
  }

  return installs.sort((a, b) => semver.rcompare(a.version, b.version))
}

async function select(install: Install): Promise<void> {
  if (!fs.existsSync(install.path)) {
    throw Error(`Cannot select Xcode at <${install.path}>: the path does not exist. `)
  }
  await exec.exec('sudo', ['xcode-select', '-s', install.path])
}

async function run(): Promise<void> {
  try {
    const version = core.getInput('version')
    if (!isValidVersionSpecification(version)) {
      throw Error(`Invalid version specification: ${version}`)
    }
    const beta = core.getInput('beta') === 'true'

    const installs = await discoverInstalls('/Applications', beta)
    core.info(`Found ${installs.length} installs`)

    const install = matchInstall(installs, version)
    if (install == null) {
      throw Error(`Could not match Xcode version ${version} in available versions <${installs.map(i => i.shortVersion)}>.`)
    }

    core.info(`Selecting Xcode ${install.shortVersion} at ${install.path}`)
    await select(install)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
