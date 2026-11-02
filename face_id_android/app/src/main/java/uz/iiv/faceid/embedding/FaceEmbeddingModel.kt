package uz.iiv.faceid.embedding

import android.content.Context
import android.graphics.Bitmap
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import kotlin.math.sqrt

class FaceEmbeddingModel(context: Context, numThreads: Int = 4) {

    private val interpreter: Interpreter
    val embeddingDim = 192
    val inputSize = 112

    init {
        val modelBuffer = loadModelFile(context, "mobile_face_net.tflite")
        val options = Interpreter.Options().apply {
            setNumThreads(numThreads)
            setUseNNAPI(false) // MobileFaceNet is ultra-light (~5MB); CPU 4 threads gives lowest latency without NNAPI init overhead
        }
        interpreter = Interpreter(modelBuffer, options)
    }

    private fun loadModelFile(context: Context, modelName: String): ByteBuffer {
        val fileDescriptor = context.assets.openFd(modelName)
        val inputStream = FileInputStream(fileDescriptor.fileDescriptor)
        val fileChannel = inputStream.channel
        val startOffset = fileDescriptor.startOffset
        val declaredLength = fileDescriptor.declaredLength
        return fileChannel.map(FileChannel.MapMode.READ_ONLY, startOffset, declaredLength)
    }

    /**
     * Extracts a normalized 192-d embedding vector from the cropped face bitmap.
     */
    @Synchronized
    fun getEmbedding(faceBitmap: Bitmap): FloatArray {
        val scaledBitmap = if (faceBitmap.width == inputSize && faceBitmap.height == inputSize) {
            faceBitmap
        } else {
            Bitmap.createScaledBitmap(faceBitmap, inputSize, inputSize, true)
        }

        // Float32 buffer: 1 * 112 * 112 * 3 * 4 bytes
        val byteBuffer = ByteBuffer.allocateDirect(1 * inputSize * inputSize * 3 * 4)
        byteBuffer.order(ByteOrder.nativeOrder())
        byteBuffer.rewind()

        val intValues = IntArray(inputSize * inputSize)
        scaledBitmap.getPixels(intValues, 0, inputSize, 0, 0, inputSize, inputSize)

        // Normalization: (value - 127.5) / 128.0
        for (pixel in intValues) {
            val r = (pixel shr 16 and 0xFF)
            val g = (pixel shr 8 and 0xFF)
            val b = (pixel and 0xFF)
            byteBuffer.putFloat((r - 127.5f) / 128.0f)
            byteBuffer.putFloat((g - 127.5f) / 128.0f)
            byteBuffer.putFloat((b - 127.5f) / 128.0f)
        }

        if (scaledBitmap != faceBitmap) {
            scaledBitmap.recycle()
        }

        val output = Array(1) { FloatArray(embeddingDim) }
        interpreter.run(byteBuffer, output)

        val rawEmbedding = output[0]
        return l2Normalize(rawEmbedding)
    }

    /**
     * L2 normalization ensures unit length, meaning cosine similarity is dot product.
     */
    private fun l2Normalize(vector: FloatArray): FloatArray {
        var sum = 0.0f
        for (v in vector) {
            sum += v * v
        }
        val norm = sqrt(sum)
        if (norm > 0) {
            for (i in vector.indices) {
                vector[i] /= norm
            }
        }
        return vector
    }

    fun close() {
        interpreter.close()
    }
}
