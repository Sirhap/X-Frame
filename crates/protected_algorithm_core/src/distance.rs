//! Integer 3-4-5 chamfer distance transform.

/// Infinite distance used by the reference transform.
const INFINITY: i16 = 0x7fff;

/// Computes the reference two-pass distance transform.
pub(crate) fn transform_seed_mask(mask: &[u8], width: usize, height: usize) -> Vec<i16> {
    let mut distance = mask
        .iter()
        .map(|value| if *value == 0 { INFINITY } else { 0 })
        .collect::<Vec<_>>();

    for y in 0..height {
        for x in 0..width {
            let index = y * width + x;
            if distance[index] == 0 {
                continue;
            }
            if x > 0 {
                update(&mut distance, index, index - 1, 3);
            }
            if y > 0 {
                update(&mut distance, index, index - width, 3);
            }
            if x > 0 && y > 0 {
                update(&mut distance, index, index - width - 1, 4);
            }
            if x + 1 < width && y > 0 {
                update(&mut distance, index, index - width + 1, 4);
            }
        }
    }
    for y in (0..height).rev() {
        for x in (0..width).rev() {
            let index = y * width + x;
            if distance[index] == 0 {
                continue;
            }
            if x + 1 < width {
                update(&mut distance, index, index + 1, 3);
            }
            if y + 1 < height {
                update(&mut distance, index, index + width, 3);
            }
            if x > 0 && y + 1 < height {
                update(&mut distance, index, index + width - 1, 4);
            }
            if x + 1 < width && y + 1 < height {
                update(&mut distance, index, index + width + 1, 4);
            }
        }
    }
    distance
}

fn update(distance: &mut [i16], index: usize, neighbor: usize, cost: i16) {
    distance[index] = distance[index].min(distance[neighbor].saturating_add(cost));
}

#[cfg(test)]
mod tests {
    use super::transform_seed_mask;

    #[test]
    fn fp_kernel_04_center_seed_matches_reference_fixture() {
        let mask = [0, 0, 0, 0, 1, 0, 0, 0, 0];
        assert_eq!(
            transform_seed_mask(&mask, 3, 3),
            [4, 3, 4, 3, 0, 3, 4, 3, 4]
        );
    }

    #[test]
    fn fp_kernel_04_transparent_mask_stays_infinite() {
        assert_eq!(transform_seed_mask(&[0, 0], 2, 1), [0x7fff, 0x7fff]);
    }
}
