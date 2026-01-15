/**
 * 统一的 Python 准备脚本
 * 下载 python-build-standalone 并解压到 resources/python 目录
 *
 * 用法:
 *   node scripts/prepare-python.mjs              # 自动检测当前平台
 *   node scripts/prepare-python.mjs darwin-arm64 # 指定 macOS ARM64
 *   node scripts/prepare-python.mjs win-x64      # 指定 Windows x64
 *
 * 注意: 此脚本使用 execSync 执行构建时操作，所有命令都是硬编码的，
 * 不涉及用户输入，因此不存在命令注入风险。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Python 版本配置 - 硬编码，非用户输入
const PYTHON_VERSION = '3.11.9'
const RELEASE_DATE = '20240726'
const VARIANT = 'install_only'

// 平台配置对象
const PLATFORM_CONFIGS = {
  'darwin-arm64': {
    name: 'macOS ARM64',
    platform: 'aarch64-apple-darwin',
    targetDir: 'darwin-arm64',
    pythonPath: ['python', 'bin', 'python3'],
    pipPath: ['python', 'bin', 'pip3'],
    needsChmod: true,
    binaries: ['python3', 'python3.11', 'pip3', 'pip3.11'],
    binDir: ['python', 'bin']
  },
  'win-x64': {
    name: 'Windows x64',
    platform: 'x86_64-pc-windows-msvc',
    targetDir: 'win32-x64',
    pythonPath: ['python', 'python.exe'],
    pipPath: ['python', 'Scripts', 'pip.exe'],
    altPipPath: ['python', 'Scripts', 'pip3.exe'],
    needsChmod: false,
    binaries: [],
    binDir: null
  }
}

/**
 * 检测当前平台
 */
function detectPlatform() {
  const platform = os.platform()
  const arch = os.arch()

  if (platform === 'darwin' && arch === 'arm64') {
    return 'darwin-arm64'
  } else if (platform === 'win32' && arch === 'x64') {
    return 'win-x64'
  } else if (platform === 'darwin' && arch === 'x64') {
    // macOS Intel 暂不支持，但可以扩展
    console.error('macOS x64 暂不支持，请手动添加配置')
    process.exit(1)
  } else {
    console.error(`不支持的平台: ${platform}-${arch}`)
    console.error('支持的平台: darwin-arm64, win-x64')
    process.exit(1)
  }
}

/**
 * 计算目录大小（用于 Windows）
 */
function calculateDirSize(dir) {
  let size = 0
  const items = fs.readdirSync(dir, { withFileTypes: true })
  for (const item of items) {
    const fullPath = path.join(dir, item.name)
    if (item.isDirectory()) {
      size += calculateDirSize(fullPath)
    } else {
      size += fs.statSync(fullPath).size
    }
  }
  return size
}

/**
 * 获取目录大小字符串
 */
function getDirSizeString(dir, config) {
  if (config.needsChmod) {
    // macOS/Linux: 使用 du 命令
    return execSync(`du -sh "${dir}"`, { encoding: 'utf8' }).trim().split('\t')[0]
  } else {
    // Windows: 手动计算
    const bytes = calculateDirSize(dir)
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }
}

/**
 * 主函数
 */
async function main() {
  // 解析命令行参数或自动检测平台
  let targetPlatform = process.argv[2]

  if (!targetPlatform) {
    targetPlatform = detectPlatform()
    console.log(`自动检测平台: ${targetPlatform}\n`)
  }

  // 验证平台参数
  const config = PLATFORM_CONFIGS[targetPlatform]
  if (!config) {
    console.error(`未知平台: ${targetPlatform}`)
    console.error('支持的平台: ' + Object.keys(PLATFORM_CONFIGS).join(', '))
    process.exit(1)
  }

  const PYTHON_DIR = path.resolve(__dirname, '../resources/python', config.targetDir)
  const DOWNLOAD_URL = `https://github.com/indygreg/python-build-standalone/releases/download/${RELEASE_DATE}/cpython-${PYTHON_VERSION}+${RELEASE_DATE}-${config.platform}-${VARIANT}.tar.gz`

  console.log(`=== 准备 Python for ${config.name} ===\n`)
  console.log(`Python 版本: ${PYTHON_VERSION}`)
  console.log(`发布日期: ${RELEASE_DATE}`)
  console.log(`目标目录: ${PYTHON_DIR}\n`)

  // 检查是否已存在
  const pythonBin = path.join(PYTHON_DIR, ...config.pythonPath)

  if (fs.existsSync(pythonBin)) {
    console.log('Python 已存在，正在检查...')

    if (config.needsChmod) {
      // macOS: 检查版本
      try {
        const version = execSync(`"${pythonBin}" --version`, { encoding: 'utf8' }).trim()
        console.log(`发现: ${version}`)
        if (version.includes(PYTHON_VERSION)) {
          console.log('版本匹配，跳过下载。')
          return
        }
        console.log('版本不匹配，重新下载...')
      } catch {
        console.log('现有 Python 无效，重新下载...')
      }
    } else {
      // Windows: 检查文件大小
      const stats = fs.statSync(pythonBin)
      if (stats.size > 1024 * 1024) {
        console.log('Python 可执行文件看起来有效，跳过下载。')
        console.log('如需重新下载，请手动删除目录。')
        return
      }
      console.log('现有 Python 无效，重新下载...')
    }
  }

  // 创建目录
  if (fs.existsSync(PYTHON_DIR)) {
    console.log('清理现有目录...')
    fs.rmSync(PYTHON_DIR, { recursive: true, force: true })
  }
  fs.mkdirSync(PYTHON_DIR, { recursive: true })

  const tarFile = path.join(PYTHON_DIR, 'python.tar.gz')

  // 下载（使用 curl，URL 来自 GitHub releases）
  console.log(`\n下载地址:\n${DOWNLOAD_URL}\n`)
  try {
    execSync(`curl -L --progress-bar -o "${tarFile}" "${DOWNLOAD_URL}"`, {
      stdio: 'inherit'
    })
  } catch (error) {
    console.error('\n下载失败，请检查网络连接。')
    console.error('也可以手动下载:')
    console.error(DOWNLOAD_URL)
    process.exit(1)
  }

  // 验证下载
  const stats = fs.statSync(tarFile)
  console.log(`\n已下载: ${(stats.size / 1024 / 1024).toFixed(2)} MB`)

  if (stats.size < 10 * 1024 * 1024) {
    console.error('下载的文件太小，可能已损坏。')
    fs.unlinkSync(tarFile)
    process.exit(1)
  }

  // 解压
  console.log('\n正在解压...')
  try {
    execSync(`tar -xzf "${tarFile}" -C "${PYTHON_DIR}"`, { stdio: 'inherit' })
  } catch (error) {
    console.error('解压失败。')
    process.exit(1)
  }

  // 清理压缩包
  fs.unlinkSync(tarFile)
  console.log('已清理压缩包。')

  // 设置可执行权限（仅 macOS/Linux）
  if (config.needsChmod && config.binDir) {
    const binDir = path.join(PYTHON_DIR, ...config.binDir)
    if (fs.existsSync(binDir)) {
      console.log('\n设置可执行权限...')
      for (const bin of config.binaries) {
        const binPath = path.join(binDir, bin)
        if (fs.existsSync(binPath)) {
          fs.chmodSync(binPath, 0o755)
          console.log(`  chmod +x ${bin}`)
        }
      }
    }
  }

  // 验证安装
  console.log('\n验证安装...')

  if (config.needsChmod) {
    // macOS: 运行 python 和 pip 检查版本
    try {
      const version = execSync(`"${pythonBin}" --version`, { encoding: 'utf8' }).trim()
      console.log(`  Python: ${version}`)

      const pipVersion = execSync(`"${pythonBin}" -m pip --version`, { encoding: 'utf8' }).trim()
      console.log(`  pip: ${pipVersion.split(' ').slice(0, 2).join(' ')}`)
    } catch (error) {
      console.error('验证失败:', error.message)
      process.exit(1)
    }
  } else {
    // Windows: 检查文件是否存在
    if (fs.existsSync(pythonBin)) {
      const exeStats = fs.statSync(pythonBin)
      console.log(`  python.exe: ${(exeStats.size / 1024 / 1024).toFixed(2)} MB`)
    } else {
      console.error('解压后未找到 python.exe!')
      process.exit(1)
    }

    const pipExe = path.join(PYTHON_DIR, ...config.pipPath)
    if (fs.existsSync(pipExe)) {
      console.log('  pip.exe: 已找到')
    } else if (config.altPipPath) {
      const altPipExe = path.join(PYTHON_DIR, ...config.altPipPath)
      if (fs.existsSync(altPipExe)) {
        console.log('  pip3.exe: 已找到')
      } else {
        console.warn('  警告: Scripts 目录中未找到 pip')
      }
    }
  }

  // 计算大小
  const totalSize = getDirSizeString(PYTHON_DIR, config)
  console.log(`\n总大小: ${totalSize}`)

  console.log(`\n✅ Python 已准备好 (${config.name})`)
}

main().catch((err) => {
  console.error('\n❌ 错误:', err.message)
  process.exit(1)
})
