# match javascript
    ...
      for await (const chunk of stream) {
    ...
    >>>
        process(chunk);
    <<<
    ...
    }
    ...
# end
# patch
    process(chunk, true);
# end
