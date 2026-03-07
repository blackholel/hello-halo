#!/bin/bash

# =============================================================================
# Kite App Icon Generator
# Generates platform-specific icons from a source SVG
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RESOURCES_DIR="$PROJECT_ROOT/resources"
SOURCE_SVG="$RESOURCES_DIR/icon.svg"
SOURCE_PNG="$RESOURCES_DIR/icon-source.png"
ICONSET_DIR="$RESOURCES_DIR/icon.iconset"
SOURCE_TYPE="svg"
SOURCE_IMAGE="$SOURCE_SVG"
SUBJECT_SCALE_PERCENT=82
EDGE_ALPHA_THRESHOLD_PERCENT=20
WORK_DIR=""

echo "🎨 Kite Icon Generator"
echo "======================"
echo ""

# Check for required tools
check_tools() {
    local missing=()

    if ! command -v convert &> /dev/null; then
        missing+=("ImageMagick (convert)")
    fi

    if [[ "$OSTYPE" == "darwin"* ]]; then
        if ! command -v iconutil &> /dev/null; then
            missing+=("iconutil")
        fi
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        echo "❌ Missing required tools:"
        for tool in "${missing[@]}"; do
            echo "   - $tool"
        done
        echo ""
        echo "Install ImageMagick: brew install imagemagick"
        exit 1
    fi

    echo "✅ All required tools available"
}

cleanup() {
    if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
        rm -rf "$WORK_DIR"
    fi
}

trap cleanup EXIT

prepare_source_png() {
    local trimmed_size
    local trim_width
    local trim_height
    local max_dim
    local padded_canvas

    WORK_DIR="$(mktemp -d)"

    trimmed_size=$(magick "$SOURCE_PNG" -trim -format "%w %h" info: 2>/dev/null || \
        convert "$SOURCE_PNG" -trim -format "%w %h" info: 2>/dev/null)

    read -r trim_width trim_height <<< "$trimmed_size"
    max_dim=$(( trim_width > trim_height ? trim_width : trim_height ))
    padded_canvas=$(( (max_dim * 100 + SUBJECT_SCALE_PERCENT - 1) / SUBJECT_SCALE_PERCENT ))

    magick "$SOURCE_PNG" -trim +repage \
        -channel A -threshold "${EDGE_ALPHA_THRESHOLD_PERCENT}%" +channel \
        -background none -gravity center \
        -extent "${padded_canvas}x${padded_canvas}" "$WORK_DIR/icon-prepared.png" 2>/dev/null || \
    convert "$SOURCE_PNG" -trim +repage \
        -channel A -threshold "${EDGE_ALPHA_THRESHOLD_PERCENT}%" +channel \
        -background none -gravity center \
        -extent "${padded_canvas}x${padded_canvas}" "$WORK_DIR/icon-prepared.png" 2>/dev/null

    SOURCE_TYPE="png"
    SOURCE_IMAGE="$WORK_DIR/icon-prepared.png"

    echo "✅ Using PNG source: $SOURCE_PNG"
    echo "   Trimmed subject: ${trim_width}x${trim_height}, padded to: ${padded_canvas}x${padded_canvas}, fill: ~${SUBJECT_SCALE_PERCENT}%"
    echo "   Edge cleanup alpha threshold: ${EDGE_ALPHA_THRESHOLD_PERCENT}%"
}

init_source() {
    if [ -f "$SOURCE_PNG" ]; then
        prepare_source_png
        return
    fi

    if [ -f "$SOURCE_SVG" ]; then
        SOURCE_TYPE="svg"
        SOURCE_IMAGE="$SOURCE_SVG"
        echo "✅ Using SVG source: $SOURCE_SVG"
        return
    fi

    echo "❌ No source icon found. Expected one of:"
    echo "   - $SOURCE_PNG"
    echo "   - $SOURCE_SVG"
    exit 1
}

# Generate PNG from SVG at specific size
generate_png() {
    local size=$1
    local output=$2
    local temp_dir=$(mktemp -d)

    if [ "$SOURCE_TYPE" = "png" ]; then
        magick "$SOURCE_IMAGE" -background none -resize "${size}x${size}" \
            -gravity center -extent "${size}x${size}" "$output" 2>/dev/null || \
        convert "$SOURCE_IMAGE" -background none -resize "${size}x${size}" \
            -gravity center -extent "${size}x${size}" "$output" 2>/dev/null
        rm -rf "$temp_dir"
        echo "   Generated: $output (${size}x${size})"
        return
    fi

    # Use qlmanage (macOS Quick Look) for proper SVG gradient rendering
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # Generate at larger size for quality
        qlmanage -t -s 1024 -o "$temp_dir" "$SOURCE_IMAGE" 2>/dev/null
        if [ -f "$temp_dir/icon.svg.png" ]; then
            # Remove white background and resize
            magick "$temp_dir/icon.svg.png" -fuzz 1% -transparent white -resize "${size}x${size}" "$output" 2>/dev/null || \
            convert "$temp_dir/icon.svg.png" -fuzz 1% -transparent white -resize "${size}x${size}" "$output" 2>/dev/null
            rm -rf "$temp_dir"
            echo "   Generated: $output (${size}x${size})"
            return
        fi
    fi

    # Fallback to ImageMagick
    magick -background none -density 300 "$SOURCE_IMAGE" -resize "${size}x${size}" -gravity center -extent "${size}x${size}" "$output" 2>/dev/null || \
    convert -background none -density 300 "$SOURCE_IMAGE" -resize "${size}x${size}" -gravity center -extent "${size}x${size}" "$output" 2>/dev/null
    rm -rf "$temp_dir"
    echo "   Generated: $output (${size}x${size})"
}

# Generate macOS iconset
generate_macos_iconset() {
    echo ""
    echo "📱 Generating macOS iconset..."

    rm -rf "$ICONSET_DIR"
    mkdir -p "$ICONSET_DIR"

    # Required sizes for macOS iconset
    local sizes=(16 32 64 128 256 512 1024)

    for size in "${sizes[@]}"; do
        generate_png $size "$ICONSET_DIR/icon_${size}x${size}.png"

        # Retina versions (except for 1024)
        if [ $size -lt 512 ]; then
            local retina_size=$((size * 2))
            generate_png $retina_size "$ICONSET_DIR/icon_${size}x${size}@2x.png"
        fi
    done

    # Special case: 512@2x = 1024
    cp "$ICONSET_DIR/icon_1024x1024.png" "$ICONSET_DIR/icon_512x512@2x.png"

    echo ""
    echo "🍎 Creating macOS .icns file..."
    iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/icon.icns"
    echo "   Generated: $RESOURCES_DIR/icon.icns"

    # Cleanup iconset folder (optional, keep for reference)
    # rm -rf "$ICONSET_DIR"
}

# Generate Windows ICO
generate_windows_ico() {
    echo ""
    echo "🪟 Generating Windows .ico file..."

    local temp_dir="$RESOURCES_DIR/temp_ico"
    mkdir -p "$temp_dir"

    # Windows ICO sizes
    local sizes=(16 24 32 48 64 128 256)
    local png_files=()

    for size in "${sizes[@]}"; do
        local png_file="$temp_dir/icon_${size}.png"
        generate_png $size "$png_file"
        png_files+=("$png_file")
    done

    # Create ICO with all sizes
    magick "${png_files[@]}" "$RESOURCES_DIR/icon.ico" 2>/dev/null || \
    convert "${png_files[@]}" "$RESOURCES_DIR/icon.ico"
    echo "   Generated: $RESOURCES_DIR/icon.ico"

    # Cleanup
    rm -rf "$temp_dir"
}

# Generate Linux PNGs
generate_linux_pngs() {
    echo ""
    echo "🐧 Generating Linux PNG files..."

    local linux_dir="$RESOURCES_DIR/linux"
    mkdir -p "$linux_dir"

    # Common Linux icon sizes
    local sizes=(16 24 32 48 64 128 256 512)

    for size in "${sizes[@]}"; do
        generate_png $size "$linux_dir/${size}x${size}.png"
    done

    # Also create a main icon.png at 512x512
    cp "$linux_dir/512x512.png" "$RESOURCES_DIR/icon.png"
    echo "   Generated: $RESOURCES_DIR/icon.png (512x512)"
}

# Generate tray icons (for system tray)
generate_tray_icons() {
    echo ""
    echo "🔔 Generating tray icons..."

    local tray_dir="$RESOURCES_DIR/tray"
    mkdir -p "$tray_dir"

    # Tray icon sizes
    generate_png 16 "$tray_dir/tray-16.png"
    generate_png 16 "$tray_dir/tray-16@2x.png"  # Actually 32px for retina
    generate_png 32 "$tray_dir/tray-16@2x.png"
    generate_png 24 "$tray_dir/tray-24.png"
    generate_png 48 "$tray_dir/tray-24@2x.png"

    # Template icons for macOS (white silhouette)
    magick -background none -density 400 "$SOURCE_IMAGE" -resize "22x22" \
        -colorspace gray -fill white -colorize 100% \
        "$tray_dir/trayTemplate.png" 2>/dev/null || \
    convert -background none -density 400 "$SOURCE_IMAGE" -resize "22x22" \
        -colorspace gray -fill white -colorize 100% \
        "$tray_dir/trayTemplate.png"
    magick -background none -density 400 "$SOURCE_IMAGE" -resize "44x44" \
        -colorspace gray -fill white -colorize 100% \
        "$tray_dir/trayTemplate@2x.png" 2>/dev/null || \
    convert -background none -density 400 "$SOURCE_IMAGE" -resize "44x44" \
        -colorspace gray -fill white -colorize 100% \
        "$tray_dir/trayTemplate@2x.png"

    echo "   Generated tray icons in $tray_dir"
}

# Main execution
main() {
    init_source
    echo "Source: $SOURCE_IMAGE"
    echo "Output: $RESOURCES_DIR"
    echo ""

    check_tools

    generate_macos_iconset
    generate_windows_ico
    generate_linux_pngs
    generate_tray_icons

    echo ""
    echo "============================================"
    echo "✅ All icons generated successfully!"
    echo ""
    echo "Generated files:"
    echo "  - icon.icns     (macOS app icon)"
    echo "  - icon.ico      (Windows app icon)"
    echo "  - icon.png      (Linux/general use)"
    echo "  - linux/        (Linux multi-size)"
    echo "  - tray/         (System tray icons)"
    echo "  - icon.iconset/ (macOS iconset source)"
    echo ""
    echo "To rebuild icons, place your new icon-source.png (preferred) or icon.svg in"
    echo "resources/ and run this script again."
    echo "============================================"
}

main "$@"
