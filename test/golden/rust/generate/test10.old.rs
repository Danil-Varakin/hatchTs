// [AWAIT] правка в цепочке с .await
pub async fn load(url: &str) -> Result<Body> {
    let response = client.get(url).send().await?;
    Ok(response.bytes().await?)
}
