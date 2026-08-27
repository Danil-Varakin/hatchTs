// [TWR] правка в списке ресурсов try-with-resources
try (InputStream in = open(path);
     OutputStream out = create(dest, true)) {
    copy(in, out);
}
