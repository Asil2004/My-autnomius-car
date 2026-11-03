package uz.iiv.faceid.embedding

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
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
    private val batchSize: Int

    init {
        val modelBuffer = loadModelFile(context, "mobile_face_net.tflite")
        val options = Interpreter.Options().apply {
            setNumThreads(numThreads)
            setUseNNAPI(false)
        }
        interpreter = Interpreter(modelBuffer, options)

        val actualShape = interpreter.getInputTensor(0).shape()
        batchSize = if (actualShape.isNotEmpty() && actualShape[0] > 0) actualShape[0] else 2
        Log.d(TAG, "Model initialized natively. Batch size: $batchSize, Input shape: ${actualShape.contentToString()}")
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

        val totalPixelsPerImage = inputSize * inputSize
        // Batch size (e.g. 2 * 112 * 112 * 3 * 4 = 301,056 bytes)
        val byteBuffer = ByteBuffer.allocateDirect(batchSize * totalPixelsPerImage * 3 * 4)
        byteBuffer.order(ByteOrder.nativeOrder())
        byteBuffer.rewind()

        val intValues = IntArray(totalPixelsPerImage)
        scaledBitmap.getPixels(intValues, 0, inputSize, 0, 0, inputSize, inputSize)

        // Fill buffer for all batch slots (duplicate image across batch)
        for (b in 0 until batchSize) {
            for (pixel in intValues) {
                val r = (pixel shr 16 and 0xFF)
                val g = (pixel shr 8 and 0xFF)
                val bVal = (pixel and 0xFF)
                byteBuffer.putFloat((r - 127.5f) / 128.0f)
                byteBuffer.putFloat((g - 127.5f) / 128.0f)
                byteBuffer.putFloat((bVal - 127.5f) / 128.0f)
            }
        }

        if (scaledBitmap != faceBitmap) {
            scaledBitmap.recycle()
        }

        val output = Array(batchSize) { FloatArray(embeddingDim) }
        interpreter.run(byteBuffer, output)

        val rawEmbedding = output[0]
        return l2Normalize(rawEmbedding)
    }

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

    companion object {
        private const val TAG = "FaceEmbeddingModel"
    }
}
