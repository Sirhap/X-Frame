#import <AppKit/AppKit.h>
#import <CoreImage/CoreImage.h>
#import <CoreVideo/CoreVideo.h>
#import <Vision/Vision.h>

/** Writes one error message and returns the supplied exit code. */
static int Fail(NSString *message, int code) {
  fprintf(stderr, "%s\n", message.UTF8String);
  return code;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) return Fail(@"Usage: subject_segmenter INPUT OUTPUT", 2);

    NSString *inputPath = [NSString stringWithUTF8String:argv[1]];
    NSString *outputPath = [NSString stringWithUTF8String:argv[2]];
    NSImage *image = [[NSImage alloc] initWithContentsOfFile:inputPath];
    CGImageRef source = [image CGImageForProposedRect:NULL context:nil hints:nil];
    if (!source) return Fail(@"The input image could not be decoded.", 3);

    VNGenerateForegroundInstanceMaskRequest *request = [VNGenerateForegroundInstanceMaskRequest new];
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:source options:@{}];
    NSError *error = nil;
    if (![handler performRequests:@[ request ] error:&error]) {
      return Fail(error.localizedDescription ?: @"Vision foreground detection failed.", 4);
    }

    VNInstanceMaskObservation *observation = request.results.firstObject;
    if (!observation || observation.allInstances.count == 0) {
      return Fail(@"Vision did not detect a foreground subject.", 5);
    }
    CVPixelBufferRef maskBuffer =
        [observation generateScaledMaskForImageForInstances:observation.allInstances
                                         fromRequestHandler:handler
                                                     error:&error];
    if (!maskBuffer) return Fail(error.localizedDescription ?: @"Vision mask generation failed.", 6);

    CIImage *original = [CIImage imageWithCGImage:source];
    CIImage *mask = [CIImage imageWithCVPixelBuffer:maskBuffer];
    CIImage *clear = [[CIImage imageWithColor:[CIColor clearColor]] imageByCroppingToRect:original.extent];
    CIFilter *blend = [CIFilter filterWithName:@"CIBlendWithMask"];
    [blend setValue:original forKey:kCIInputImageKey];
    [blend setValue:clear forKey:kCIInputBackgroundImageKey];
    [blend setValue:mask forKey:kCIInputMaskImageKey];

    CIContext *context = [CIContext context];
    CGImageRef result = [context createCGImage:blend.outputImage fromRect:original.extent];
    CVPixelBufferRelease(maskBuffer);
    if (!result) return Fail(@"The segmented image could not be rendered.", 7);

    NSBitmapImageRep *representation = [[NSBitmapImageRep alloc] initWithCGImage:result];
    CGImageRelease(result);
    NSData *png = [representation representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    if (!png || ![png writeToFile:outputPath options:NSDataWritingAtomic error:&error]) {
      return Fail(error.localizedDescription ?: @"The segmented image could not be written.", 8);
    }
  }
  return 0;
}
