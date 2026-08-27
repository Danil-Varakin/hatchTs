// [JSXSELF] самозакрывающийся тег превращается в парный
export function Icon() {
  return <picture src={url} alt=""><img src={url} /></picture>;
}
