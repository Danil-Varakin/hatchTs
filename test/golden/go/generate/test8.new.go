// [METHODSET] правка сигнатуры в середине интерфейса
type Store interface {
	Get(key string) ([]byte, error)
	Put(key string, value []byte, ttl time.Duration) error
	Delete(key string) error
}
