// [TEMPLITTYPE] правка внутри template literal type
type Route = `/${string}/${'get' | 'put' | 'del'}`;
type Handler = Record<Route, () => void>;
