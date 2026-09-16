//! HEIC/HEIF decoding (not built on Windows, where HEIC input is unsupported).
//!
//! - macOS uses the system ImageIO framework, so the app bundle has no
//!   third-party library to ship and runs on any Mac.
//! - Other Unix targets link against system libheif.
//!
//! Both return an upright RGB8 image: the container's rotation/mirroring is
//! already applied.

use std::path::Path;

use image::DynamicImage;

/// Decodes a HEIC/HEIF file to an RGB8 image using ImageIO.
#[cfg(target_os = "macos")]
pub(crate) fn decode_heic(src: &Path) -> Result<DynamicImage, String> {
    use std::ffi::c_void;

    use objc2_core_foundation::{CFURL, CGPoint, CGRect, CGSize};
    use objc2_core_graphics::{
        kCGColorSpaceSRGB, CGBitmapContextCreate, CGColorSpace, CGContext, CGImage,
        CGImageAlphaInfo,
    };
    use objc2_image_io::CGImageSource;

    let url = CFURL::from_file_path(src).ok_or("invalid file path")?;
    // SAFETY: `url` is a valid file URL and no options are passed.
    let source = unsafe { CGImageSource::with_url(&url, None) }.ok_or("could not open the file")?;
    // SAFETY: index 0 is the primary image; ImageIO returns None if it's missing.
    let image = unsafe { source.image_at_index(0, None) }.ok_or("could not decode the HEIC image")?;

    let width = CGImage::width(Some(&image));
    let height = CGImage::height(Some(&image));
    if width == 0 || height == 0 {
        return Err("the HEIC image is empty".into());
    }

    // Draw into an sRGB RGBX buffer. The color space conversion also maps
    // Display P3 iPhone photos to sRGB, which the encoders expect.
    let mut rgbx = vec![0u8; width * height * 4];
    // SAFETY: `kCGColorSpaceSRGB` is a constant provided by CoreGraphics.
    let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))
        .ok_or("sRGB color space unavailable")?;
    // SAFETY: `rgbx` holds exactly width × height × 4 bytes and outlives `ctx`,
    // which is dropped before the buffer is read.
    let ctx = unsafe {
        CGBitmapContextCreate(
            rgbx.as_mut_ptr().cast::<c_void>(),
            width,
            height,
            8,
            width * 4,
            Some(&space),
            CGImageAlphaInfo::NoneSkipLast.0,
        )
    }
    .ok_or("could not allocate the image buffer")?;
    let rect = CGRect::new(
        CGPoint::new(0.0, 0.0),
        CGSize::new(width as f64, height as f64),
    );
    CGContext::draw_image(Some(&ctx), rect, Some(&image));
    drop(ctx);

    let rgb: Vec<u8> = rgbx
        .chunks_exact(4)
        .flat_map(|px| [px[0], px[1], px[2]])
        .collect();
    drop(rgbx);

    let mut img = image::RgbImage::from_raw(width as u32, height as u32, rgb)
        .map(DynamicImage::ImageRgb8)
        .ok_or("failed to build image from HEIC pixels")?;

    // `image_at_index` returns the stored pixels; the rotation/mirroring from
    // the HEIC container is reported separately as an EXIF-style orientation.
    if let Some(orientation) = orientation_of(&source) {
        img.apply_orientation(orientation);
    }
    Ok(img)
}

/// The primary image's orientation, as reported by ImageIO.
#[cfg(target_os = "macos")]
fn orientation_of(source: &objc2_image_io::CGImageSource) -> Option<image::metadata::Orientation> {
    use objc2_core_foundation::{CFNumber, CFString, CFType};
    use objc2_image_io::kCGImagePropertyOrientation;

    // SAFETY: index 0 is the primary image; no options are passed.
    let props = unsafe { source.properties_at_index(0, None) }?;
    // SAFETY: `kCGImagePropertyOrientation` is a constant provided by ImageIO.
    let key: &CFString = unsafe { kCGImagePropertyOrientation };
    // SAFETY: `props` is a CFString-keyed dictionary we own and don't mutate.
    let value = unsafe { props.value((key as *const CFString).cast()) };
    if value.is_null() {
        return None;
    }
    // SAFETY: dictionary values are non-null CoreFoundation objects.
    let value: &CFType = unsafe { &*value.cast::<CFType>() };
    let exif = value.downcast_ref::<CFNumber>()?.as_i32()?;
    image::metadata::Orientation::from_exif(u8::try_from(exif).ok()?)
}

/// Decodes a HEIC/HEIF file to an RGB8 image using system libheif.
#[cfg(not(target_os = "macos"))]
pub(crate) fn decode_heic(src: &Path) -> Result<DynamicImage, String> {
    use libheif_rs::{ColorSpace, HeifContext, LibHeif, RgbChroma};

    let path = src.to_str().ok_or("path is not valid UTF-8")?;
    let lib_heif = LibHeif::new();
    let ctx = HeifContext::read_from_file(path).map_err(|e| e.to_string())?;
    let handle = ctx.primary_image_handle().map_err(|e| e.to_string())?;
    let decoded = lib_heif
        .decode(&handle, ColorSpace::Rgb(RgbChroma::Rgb), None)
        .map_err(|e| e.to_string())?;

    let planes = decoded.planes();
    let plane = planes
        .interleaved
        .ok_or("HEIC image has no interleaved RGB plane")?;

    let width = plane.width as usize;
    let height = plane.height as usize;
    let stride = plane.stride;
    let row_bytes = width * 3;

    // libheif rows are padded to `stride`; repack into a tight RGB buffer.
    let mut buf = Vec::with_capacity(width * height * 3);
    for y in 0..height {
        let start = y * stride;
        buf.extend_from_slice(&plane.data[start..start + row_bytes]);
    }

    image::RgbImage::from_raw(width as u32, height as u32, buf)
        .map(DynamicImage::ImageRgb8)
        .ok_or_else(|| "failed to build image from HEIC pixels".into())
}
