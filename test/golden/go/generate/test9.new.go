// [TICKSTR] сырая строка в обратных кавычках: скобки и переводы строк внутри — не структура
const query = `
SELECT id, name
FROM users
WHERE age >= 21 AND (role = 'admin' OR role = 'root')
`

func all(db *sql.DB) (*sql.Rows, error) {
	return db.Query(query)
}
