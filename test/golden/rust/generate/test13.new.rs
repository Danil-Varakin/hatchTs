// [TRAIT] правка дефолтного метода в трейте
pub trait Shape {
    fn area(&self) -> f64;
    fn describe(&self) -> String {
        format!("area is {:.2}", self.area())
    }
}
