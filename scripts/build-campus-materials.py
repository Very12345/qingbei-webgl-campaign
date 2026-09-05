from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "public" / "materials"
TARGET.mkdir(parents=True, exist_ok=True)
SIZE = 512
y, x = np.mgrid[0:SIZE, 0:SIZE] / SIZE
rng = np.random.default_rng(202608)


def periodic_noise(terms):
    value = np.zeros((SIZE, SIZE), dtype=np.float32)
    amplitude = 0.0
    for frequency, weight, count in terms:
        for _ in range(count):
            kx = int(rng.integers(1, frequency + 1))
            ky = int(rng.integers(1, frequency + 1))
            phase = float(rng.random() * np.pi * 2)
            value += np.sin((x * kx + y * ky) * np.pi * 2 + phase) * weight
            amplitude += weight
    return value / max(amplitude, 0.001)


def spectral_noise(beta):
    white = rng.normal(0, 1, (SIZE, SIZE))
    spectrum = np.fft.rfft2(white)
    fy = np.fft.fftfreq(SIZE)[:, None]
    fx = np.fft.rfftfreq(SIZE)[None, :]
    frequency = np.sqrt(fx * fx + fy * fy)
    frequency[0, 0] = 1
    spectrum *= 1 / np.power(frequency, beta / 2)
    spectrum[0, 0] = 0
    value = np.fft.irfft2(spectrum, s=(SIZE, SIZE)).real
    return value / max(value.std(), 0.001)


def save(name, rgb, quality=82):
    image = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")
    image.save(TARGET / name, "WEBP", quality=quality, method=6)


grass_noise = spectral_noise(2.35) * 0.42
grass_flecks = spectral_noise(0.55) * 0.16
grass = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
grass_base = np.array([103, 128, 76], dtype=np.float32)
grass[:] = grass_base + grass_noise[..., None] * np.array([15, 18, 11]) + grass_flecks[..., None] * np.array([8, 9, 5])
save("campus-grass-albedo.webp", grass)
grass_rough = np.repeat((222 + grass_noise[..., None] * 18), 3, axis=2)
save("campus-grass-roughness.webp", grass_rough, 76)

asphalt_noise = spectral_noise(0.8) * 0.28 + spectral_noise(2.4) * 0.12
asphalt = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
asphalt[:] = np.array([64, 67, 66]) + asphalt_noise[..., None] * np.array([11, 12, 11])
aggregate = rng.random((SIZE, SIZE)) > 0.998
asphalt[aggregate] += rng.integers(8, 20, size=(aggregate.sum(), 1))
save("campus-asphalt-albedo.webp", asphalt)
asphalt_rough = np.repeat((205 + asphalt_noise[..., None] * 25), 3, axis=2)
save("campus-asphalt-roughness.webp", asphalt_rough, 76)

paving_noise = spectral_noise(1.25) * 0.32
paving = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
paving[:] = np.array([172, 161, 139]) + paving_noise[..., None] * np.array([16, 15, 13])
grid = (np.mod(np.arange(SIZE), 64) < 3)
paving[grid, :, :] *= 0.72
paving[:, grid, :] *= 0.72
save("campus-paving-albedo.webp", paving)
paving_rough = np.repeat((214 + paving_noise[..., None] * 16), 3, axis=2)
save("campus-paving-roughness.webp", paving_rough, 76)

facade_noise = spectral_noise(1.7) * 0.36
facade = np.repeat((218 + facade_noise[..., None] * 20), 3, axis=2)
save("campus-facade-detail.webp", facade)
facade_rough = np.repeat((210 + facade_noise[..., None] * 22), 3, axis=2)
save("campus-facade-roughness.webp", facade_rough, 76)

water_height = spectral_noise(2.2) * 0.42 + spectral_noise(0.7) * 0.08
gradient_y, gradient_x = np.gradient(water_height)
normal = np.stack((-gradient_x * 2.2, -gradient_y * 2.2, np.ones_like(water_height)), axis=2)
normal /= np.linalg.norm(normal, axis=2, keepdims=True)
normal = (normal * 0.5 + 0.5) * 255
save("campus-water-normal.webp", normal, 82)

print({path.name: path.stat().st_size for path in sorted(TARGET.glob("campus-*.webp"))})
