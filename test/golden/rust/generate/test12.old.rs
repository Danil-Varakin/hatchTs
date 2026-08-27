// [CONSTGEN] правка константного дженерик-параметра <const N: usize>
pub struct Buffer<const N: usize> {
    data: [u8; N],
}

impl<const N: usize> Buffer<N> {
    pub fn len(&self) -> usize {
        N
    }
}
