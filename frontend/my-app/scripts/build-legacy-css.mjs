import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { browserslistToTargets, transform } from 'lightningcss'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')
const stylesDir = path.join(appRoot, 'src', 'styles')
const publicDir = path.join(appRoot, 'public')
const legacyCssPath = path.join(publicDir, 'legacy.css')

const legacyTargets = browserslistToTargets([
  'chrome 87',
  'firefox 78',
  'safari 14',
])

function unwrapLayerBlock(css, layerName) {
  const layerStartPattern = new RegExp(`@layer\\s+${layerName}\\s*\\{`, 'g')
  const layerStartMatch = layerStartPattern.exec(css)

  if (!layerStartMatch) {
    throw new Error(`Unable to find @layer ${layerName} block in theme.css`)
  }

  const blockContentStart = layerStartMatch.index + layerStartMatch[0].length
  let depth = 1

  for (let index = blockContentStart; index < css.length; index += 1) {
    if (css[index] === '{') {
      depth += 1
    } else if (css[index] === '}') {
      depth -= 1

      if (depth === 0) {
        return `${css.slice(0, layerStartMatch.index)}${css.slice(blockContentStart, index)}${css.slice(index + 1)}`
      }
    }
  }

  throw new Error(`Unable to find the end of @layer ${layerName} block in theme.css`)
}

function flattenLayerRules(css) {
  let output = ''
  let currentIndex = 0

  while (currentIndex < css.length) {
    const layerIndex = css.indexOf('@layer', currentIndex)

    if (layerIndex === -1) {
      output += css.slice(currentIndex)
      break
    }

    output += css.slice(currentIndex, layerIndex)

    const blockStart = css.indexOf('{', layerIndex)
    const statementEnd = css.indexOf(';', layerIndex)

    if (statementEnd !== -1 && (blockStart === -1 || statementEnd < blockStart)) {
      currentIndex = statementEnd + 1
      continue
    }

    if (blockStart === -1) {
      output += css.slice(layerIndex)
      break
    }

    let depth = 1

    for (let index = blockStart + 1; index < css.length; index += 1) {
      if (css[index] === '{') {
        depth += 1
      } else if (css[index] === '}') {
        depth -= 1

        if (depth === 0) {
          output += css.slice(blockStart + 1, index)
          currentIndex = index + 1
          break
        }
      }
    }

    if (depth !== 0) {
      throw new Error('Unable to flatten generated @layer block')
    }
  }

  return output
}

function lowerLegacyGradientSyntax(css) {
  return css.replace(/ in oklab/g, '').replace(/ in lab/g, '')
}

async function runTailwind(inputPath, outputPath) {
  const tailwindCliPath = path.join(
    appRoot,
    'node_modules',
    '@tailwindcss',
    'cli',
    'dist',
    'index.mjs',
  )

  await execFileAsync(
    process.execPath,
    [tailwindCliPath, '-i', inputPath, '-o', outputPath],
    { cwd: appRoot },
  )
}

async function buildLegacyCss() {
  const tempDir = await mkdtemp(path.join(appRoot, '.legacy-css-'))

  try {
    const themeCss = await readFile(path.join(stylesDir, 'theme.css'), 'utf8')
    const legacyThemeCss = unwrapLayerBlock(themeCss, 'base')
    const legacyThemePath = path.join(tempDir, 'legacy-theme.css')
    const legacyInputPath = path.join(tempDir, 'legacy-input.css')
    const tailwindOutputPath = path.join(tempDir, 'legacy-tailwind.css')

    await writeFile(legacyThemePath, legacyThemeCss)
    await writeFile(
      legacyInputPath,
      [
        "@import 'tailwindcss/theme.css';",
        "@import 'tailwindcss/preflight.css';",
        "@import 'tailwindcss/utilities.css' source(none);",
        "@source '../src/**/*.{js,ts,jsx,tsx}';",
        "@import 'tw-animate-css';",
        `@import '${legacyThemePath.replace(/\\/g, '/')}';`,
        '',
      ].join('\n'),
    )

    await runTailwind(legacyInputPath, tailwindOutputPath)

    const tailwindOutput = lowerLegacyGradientSyntax(
      flattenLayerRules(await readFile(tailwindOutputPath, 'utf8')),
    )
    const { code } = transform({
      code: Buffer.from(tailwindOutput),
      filename: 'legacy.css',
      minify: true,
      sourceMap: false,
      targets: legacyTargets,
    })

    await writeFile(legacyCssPath, code)
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
}

await buildLegacyCss()
