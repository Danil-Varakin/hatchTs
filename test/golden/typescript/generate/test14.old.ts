// [TEMPLITTYPE] правка внутри template literal type
type Route = `/${string}/${'get' | 'put'}`;
type Handler = Record<Route, () => void>;
