// [CONSTGEN] правка константного дженерик-параметра <const N: usize>
pub struct Buffer<const N: usize> {
    data: [u16; N],
}

impl<const N: usize> Buffer<N> {
    pub fn len(&self) -> usize {
        N
    }
}
